const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { SidecarManager } = require('./apps/electron/main/sidecar/manager.cjs');

/** @type {import('http').Server | null} */
let staticServer = null;
let mainWindow = null;
let sidecarManager = null;
let isQuitting = false;
const isSmokeTest = process.argv.includes('--smoke-test');

function writeMainLog(level, message) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, source: 'electron-main', message });
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'main.log'), `${line}\n`, 'utf8');
  } catch (_) {
    // Logging must not prevent application startup.
  }
}

function publishBackendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backend:status', status);
}

function setupIpc() {
  ipcMain.handle('backend:get-connection', () => sidecarManager?.getConnection() || null);
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('dialog:open-file', async (_event, options = {}) => {
    const safeOptions = {
      title: typeof options.title === 'string' ? options.title : 'Select a file',
      properties: Array.isArray(options.properties)
        ? options.properties.filter((item) => ['openFile', 'multiSelections'].includes(item))
        : ['openFile'],
      filters: Array.isArray(options.filters) ? options.filters : undefined
    };
    return dialog.showOpenDialog(mainWindow, safeOptions);
  });
  ipcMain.handle('notification:show', (_event, options = {}) => {
    if (!Notification.isSupported()) return false;
    new Notification({
      title: String(options.title || 'Garfield Chat'),
      body: String(options.body || '')
    }).show();
    return true;
  });
}

function ensureRuntimeConfigFile() {
  try {
    const userDir = app.getPath('userData');
    const cfgPath = path.join(userDir, 'runtime-config.json');
    if (!fs.existsSync(cfgPath)) {
      fs.mkdirSync(userDir, { recursive: true });
      const defaultCfg = {
        xunfei: {
          sparkTTSVcnMale: 'x5_lingfeiyi_flow',
          sparkTTSVcnFemale: 'x5_lingxiaoxuan_flow'
        }
      };
      fs.writeFileSync(cfgPath, JSON.stringify(defaultCfg, null, 2), 'utf-8');
    }
    return cfgPath;
  } catch (e) {
    return null;
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function startStaticServer(distDir) {
  return new Promise((resolve, reject) => {
    try {
      const server = http.createServer((req, res) => {
        const requestUrl = req.url || '/';
        // strip query/hash
        const pathname = decodeURIComponent(requestUrl.split('?')[0].split('#')[0]);

        // basic path traversal guard
        if (pathname.includes('..')) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        // 运行时配置：优先从用户目录读取，便于打包后直接修改音色等参数
        if (pathname === '/runtime-config.json') {
          const cfgPath = ensureRuntimeConfigFile();
          if (!cfgPath) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
          }
          fs.readFile(cfgPath, 'utf-8', (err, text) => {
            if (err) {
              res.statusCode = 500;
              res.end('Internal Server Error');
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(text);
          });
          return;
        }

        const relPath = pathname === '/' ? '/index.html' : pathname;
        const candidatePath = path.join(distDir, relPath);

        const serveFile = (filePath) => {
          fs.readFile(filePath, (err, data) => {
            if (err) {
              res.statusCode = 500;
              res.end('Internal Server Error');
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', getContentType(filePath));
            res.end(data);
          });
        };

        fs.stat(candidatePath, (err, stat) => {
          if (!err && stat.isFile()) {
            serveFile(candidatePath);
            return;
          }

          // SPA fallback
          serveFile(path.join(distDir, 'index.html'));
        });
      });

      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        staticServer = server;
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve({ server, port });
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    show: !isSmokeTest,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'apps/electron/preload/index.cjs'),
    },
    autoHideMenuBar: true,
    resizable: true,
    icon: path.join(__dirname, 'dist/favicon.ico')
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

  // 开发环境加载本地服务器，生产环境通过本地 http server 加载 dist（避免 file:// origin 为 null）
  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    ensureRuntimeConfigFile();
    const distDir = path.join(__dirname, 'dist');
    const { port } = await startStaticServer(distDir);
    win.loadURL(`http://127.0.0.1:${port}/`);
  }
}

app.whenReady().then(async () => {
  setupIpc();
  sidecarManager = new SidecarManager({
    rootDir: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : __dirname,
    logDir: path.join(app.getPath('userData'), 'logs', 'backend'),
    log: writeMainLog
  });
  sidecarManager.on('status', publishBackendStatus);
  try {
    await sidecarManager.start();
  } catch (error) {
    writeMainLog('error', `Backend failed to start: ${error.message}`);
  }

  await createWindow();
  publishBackendStatus(sidecarManager.getStatus());
  if (isSmokeTest) {
    if (sidecarManager.getStatus().state !== 'ready') process.exitCode = 1;
    setTimeout(() => app.quit(), 500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!isQuitting && sidecarManager) {
    event.preventDefault();
    isQuitting = true;
    sidecarManager.stop().finally(() => app.quit());
    return;
  }
  if (staticServer) {
    try {
      staticServer.close();
    } catch (e) {
      // ignore
    }
    staticServer = null;
  }
});

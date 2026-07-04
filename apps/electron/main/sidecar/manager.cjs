const { EventEmitter } = require('events');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function allocatePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestHealth(connection, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: connection.port,
      path: '/health',
      method: 'GET',
      timeout: timeoutMs,
      headers: { Authorization: `Bearer ${connection.token}` }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Health check returned ${response.statusCode}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          parsed.status === 'ok' ? resolve(parsed) : reject(new Error('Backend is not healthy'));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Health check timed out')));
    request.on('error', reject);
    request.end();
  });
}

function createCancelledError() {
  const error = new Error('Sidecar launch was cancelled');
  error.code = 'SIDECAR_CANCELLED';
  return error;
}

function isCancelledError(error) {
  return error?.code === 'SIDECAR_CANCELLED';
}

class SidecarManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rootDir = options.rootDir || process.cwd();
    this.logDir = options.logDir || path.join(this.rootDir, 'backend', 'logs');
    this.pythonCommand = options.pythonCommand || process.env.AGENT_PYTHON || 'python';
    this.spawnImpl = options.spawnImpl || spawn;
    this.healthTimeoutMs = options.healthTimeoutMs || 15000;
    this.healthIntervalMs = options.healthIntervalMs || 200;
    this.envFile = options.envFile || process.env.AGENT_ENV_FILE || null;
    this.allocatePortImpl = options.allocatePortImpl || allocatePort;
    this.log = options.log || (() => {});
    this.child = null;
    this.connection = null;
    this.intentionalStop = false;
    this.restartBudget = 1;
    this.lastStatus = { state: 'stopped', detail: 'Backend has not started' };
    this.lifecycleGeneration = 0;
  }

  getConnection() {
    return this.lastStatus.state === 'ready' && this.connection
      ? { ...this.connection }
      : null;
  }

  getStatus() {
    return { ...this.lastStatus };
  }

  emitStatus(state, detail) {
    this.lastStatus = { state, detail, timestamp: new Date().toISOString() };
    this.emit('status', this.getStatus());
  }

  async start() {
    if (this.child && this.connection) return this.getConnection();
    this.intentionalStop = false;
    this.restartBudget = 1;
    const generation = ++this.lifecycleGeneration;
    try {
      return await this.launch(generation);
    } catch (error) {
      if (isCancelledError(error)) throw error;
      if (this.restartBudget > 0) {
        this.restartBudget -= 1;
        this.emitStatus('restarting', 'Backend failed during startup; restarting once');
        try {
          return await this.launch(generation);
        } catch (retryError) {
          if (!isCancelledError(retryError)) this.emitStatus('failed', retryError.message);
          throw retryError;
        }
      }
      this.emitStatus('failed', error.message);
      throw error;
    }
  }

  async launch(generation = this.lifecycleGeneration) {
    const port = await this.allocatePortImpl();
    if (this.intentionalStop || generation !== this.lifecycleGeneration) {
      throw createCancelledError();
    }
    const token = crypto.randomBytes(32).toString('hex');
    const connection = {
      port,
      token,
      httpUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws/v1`
    };
    this.connection = connection;
    this.emitStatus('starting', `Starting backend on port ${port}`);

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      AGENT_HOST: '127.0.0.1',
      AGENT_PORT: String(port),
      AGENT_AUTH_TOKEN: token,
      AGENT_LOG_DIR: this.logDir,
      ...(this.envFile ? { AGENT_ENV_FILE: this.envFile } : {})
    };
    const child = this.spawnImpl(
      this.pythonCommand,
      ['-m', 'backend.app.main', '--host', '127.0.0.1', '--port', String(port)],
      { cwd: this.rootDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    this.child = child;
    child.stdout?.on('data', (chunk) => this.log('info', chunk.toString().trim()));
    child.stderr?.on('data', (chunk) => this.log('error', chunk.toString().trim()));

    let rejectStartupFailure;
    const startupFailure = new Promise((_, reject) => { rejectStartupFailure = reject; });
    const onStartupError = (error) => rejectStartupFailure(error);
    const onStartupExit = (code, signal) => rejectStartupFailure(
      new Error(`Backend exited during startup (code=${code}, signal=${signal})`)
    );
    child.once('error', onStartupError);
    child.once('exit', onStartupExit);

    try {
      await Promise.race([this.waitUntilHealthy(child, connection), startupFailure]);
    } catch (error) {
      child.removeListener('error', onStartupError);
      child.removeListener('exit', onStartupExit);
      child.on('error', (lateError) => this.log('error', `Backend process error: ${lateError.message}`));
      if (this.child === child) this.child = null;
      if (this.connection === connection) this.connection = null;
      if (!child.killed) {
        try { child.kill(); } catch (_) { /* Process already unavailable. */ }
      }
      if (this.intentionalStop || generation !== this.lifecycleGeneration) {
        throw createCancelledError();
      }
      throw error;
    }

    child.removeListener('error', onStartupError);
    child.removeListener('exit', onStartupExit);
    if (this.intentionalStop || generation !== this.lifecycleGeneration) {
      if (this.child === child) this.child = null;
      if (this.connection === connection) this.connection = null;
      if (!child.killed) child.kill();
      throw createCancelledError();
    }
    if (this.child !== child || child.exitCode !== null) {
      throw new Error('Backend process changed or exited during startup');
    }
    child.on('error', (error) => this.log('error', `Backend process error: ${error.message}`));
    child.once('exit', (code, signal) => this.handleExit(child, code, signal));
    this.emitStatus('ready', `Backend ready on port ${port}`);
    return this.getConnection();
  }

  async waitUntilHealthy(child, connection) {
    const deadline = Date.now() + this.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Backend exited with code ${child.exitCode}`);
      try {
        await requestHealth(connection);
        return;
      } catch (_) {
        await new Promise((resolve) => setTimeout(resolve, this.healthIntervalMs));
      }
    }
    throw new Error('Backend health check timed out');
  }

  handleExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    this.connection = null;
    if (this.intentionalStop) {
      this.emitStatus('stopped', 'Backend stopped');
      return;
    }

    this.log('error', `Backend exited unexpectedly (code=${code}, signal=${signal})`);
    if (this.restartBudget > 0) {
      this.restartBudget -= 1;
      this.emitStatus('restarting', 'Backend exited; restarting once');
      const generation = this.lifecycleGeneration;
      this.launch(generation).catch((error) => {
        if (!isCancelledError(error)) this.emitStatus('failed', error.message);
      });
    } else {
      this.emitStatus('failed', 'Backend exited after restart budget was exhausted');
    }
  }

  async stop() {
    this.intentionalStop = true;
    this.lifecycleGeneration += 1;
    const child = this.child;
    this.child = null;
    this.connection = null;
    if (!child || child.exitCode !== null) {
      this.emitStatus('stopped', 'Backend stopped');
      return;
    }

    this.emitStatus('stopping', 'Stopping backend');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
    this.emitStatus('stopped', 'Backend stopped');
  }
}

module.exports = { SidecarManager, allocatePort, requestHealth };

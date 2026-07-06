import React, { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent } from '../../generated/contracts';
import { SessionClient } from '../../services/sessionClient';

type EchoState = 'idle' | 'running' | 'passed' | 'failed';
const statusColor: Record<string, string> = {
  ready: 'bg-emerald-500', starting: 'bg-amber-400', restarting: 'bg-amber-500',
  stopping: 'bg-slate-400', stopped: 'bg-slate-400', failed: 'bg-red-500', browser: 'bg-slate-300'
};
const statusText: Record<string, string> = {
  ready: '已就绪', starting: '启动中', restarting: '重启中', stopping: '停止中',
  stopped: '已停止', failed: '失败', browser: '浏览器模式'
};

export function DiagnosticsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<BackendStatus | { state: 'browser'; detail: string }>({ state: 'browser', detail: 'Electron preload 不可用' });
  const [connection, setConnection] = useState<BackendConnection | null>(null);
  const [appVersion, setAppVersion] = useState('web');
  const [backendVersion, setBackendVersion] = useState('unknown');
  const [echoState, setEchoState] = useState<EchoState>('idle');
  const [echoDetail, setEchoDetail] = useState('尚未测试');
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);
  const [requestId, setRequestId] = useState('');
  const [diagnosticCount, setDiagnosticCount] = useState(0);

  const refreshConnection = useCallback(async () => {
    const bridge = window.agentDesktop;
    if (!bridge) return;
    const next = await bridge.getBackendConnection();
    setConnection(next);
    if (!next) return;
    setStatus({ state: 'ready', detail: '后端连接可用' });
    try {
      const response = await fetch(next.httpUrl + '/version', { headers: { Authorization: 'Bearer ' + next.token } });
      const payload = await response.json() as { version?: string };
      setBackendVersion(payload.version || 'unknown');
    } catch { setBackendVersion('unavailable'); }
  }, []);

  useEffect(() => {
    const bridge = window.agentDesktop;
    if (!bridge) return;
    void bridge.getAppVersion().then(setAppVersion);
    void refreshConnection();
    return bridge.onBackendStatus((next) => {
      setStatus(next);
      if (next.state === 'ready') void refreshConnection();
      if (next.state === 'failed' || next.state === 'stopped') setConnection(null);
    });
  }, [refreshConnection]);

  const runEcho = useCallback(async () => {
    const current = connection || await window.agentDesktop?.getBackendConnection() || null;
    if (!current) { setEchoState('failed'); setEchoDetail('后端连接不可用'); return; }
    setEchoState('running'); setEchoDetail('等待 WebSocket 回显');
    const echoRequestId = uuidv4(), sessionId = uuidv4();
    const socket = new WebSocket(current.wsUrl, ['agent.v1', current.token]);
    const timeout = window.setTimeout(() => { socket.close(); setEchoState('failed'); setEchoDetail('回显超时'); }, 5000);
    socket.onopen = () => {
      const event: AgentEvent<{ message: string }> = { type: 'diagnostics.echo.request', version: '1.0', session_id: sessionId, request_id: echoRequestId, timestamp: new Date().toISOString(), data: { message: 'ping' } };
      socket.send(JSON.stringify(event));
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as AgentEvent;
        if (event.type !== 'diagnostics.echo.response' || event.request_id !== echoRequestId) throw new Error('关联 ID 不匹配');
        window.clearTimeout(timeout); setEchoState('passed'); setEchoDetail('WebSocket 回显正常'); socket.close();
      } catch (error) {
        window.clearTimeout(timeout); setEchoState('failed'); setEchoDetail(error instanceof Error ? error.message : '响应无效'); socket.close();
      }
    };
    socket.onerror = () => { window.clearTimeout(timeout); setEchoState('failed'); setEchoDetail('WebSocket 连接失败'); };
  }, [connection]);

  const loadDiagnostics = async () => {
    try {
      const result = await new SessionClient().diagnostics(requestId.trim() || undefined);
      setSchemaVersion(result.schema_version);
      setDiagnosticCount(result.logs.length + result.tool_audits.length);
    } catch { setDiagnosticCount(0); }
  };

  return (
    <div className="fixed top-16 right-4 z-[80] text-xs">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-md" title="后端诊断">
        <span className={'h-2.5 w-2.5 rounded-full ' + (statusColor[status.state] || statusColor.failed)} />
        <span>后端：{statusText[status.state] || status.state}</span>
      </button>
      {expanded && (
        <div className="mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="font-bold text-slate-700">后端诊断</div>
          <div className="mt-2 text-slate-500">应用 {appVersion} · 后端 {backendVersion}</div>
          <div className="mt-1 break-words text-slate-600">{status.detail}</div>
          <div className="mt-1 text-slate-500">端口：{connection?.port ?? '不可用'} · 数据库：{schemaVersion ?? '未读取'}</div>
          <button type="button" onClick={() => void runEcho()} disabled={!connection || echoState === 'running'} className="mt-3 w-full rounded-lg bg-slate-800 px-3 py-2 font-semibold text-white disabled:opacity-40">
            {echoState === 'running' ? '测试中…' : '测试 WebSocket'}
          </button>
          <div className="mt-2 text-slate-500">{echoDetail}</div>
          <input value={requestId} onChange={(event) => setRequestId(event.target.value)} placeholder="可选：request ID" className="mt-3 w-full rounded-lg border px-2 py-2" />
          <button type="button" onClick={() => void loadDiagnostics()} className="mt-2 w-full rounded-lg bg-orange-500 px-3 py-2 font-semibold text-white">查询脱敏日志</button>
          <div className="mt-2 text-slate-500">匹配记录：{diagnosticCount}</div>
        </div>
      )}
    </div>
  );
}

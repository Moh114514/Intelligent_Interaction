import React, { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent } from '../../generated/contracts';

type EchoState = 'idle' | 'running' | 'passed' | 'failed';

const statusColor: Record<string, string> = {
  ready: 'bg-emerald-500',
  starting: 'bg-amber-400',
  restarting: 'bg-amber-500',
  stopping: 'bg-slate-400',
  stopped: 'bg-slate-400',
  failed: 'bg-red-500',
  browser: 'bg-slate-300'
};

export function DiagnosticsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<BackendStatus | { state: 'browser'; detail: string }>({
    state: 'browser',
    detail: 'Electron preload is unavailable'
  });
  const [connection, setConnection] = useState<BackendConnection | null>(null);
  const [appVersion, setAppVersion] = useState('web');
  const [echoState, setEchoState] = useState<EchoState>('idle');
  const [backendVersion, setBackendVersion] = useState('unknown');
  const [echoDetail, setEchoDetail] = useState('Not tested');

  const refreshConnection = useCallback(async () => {
    const bridge = window.agentDesktop;
    if (!bridge) return;
    const next = await bridge.getBackendConnection();
    setConnection(next);
    if (next) {
      try {
        const response = await fetch(`${next.httpUrl}/version`, {
          headers: { Authorization: `Bearer ${next.token}` }
        });
        const payload = await response.json() as { version?: string };
        setBackendVersion(payload.version || 'unknown');
      } catch (_) {
        setBackendVersion('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    const bridge = window.agentDesktop;
    if (!bridge) return;

    void bridge.getAppVersion().then(setAppVersion);
    void refreshConnection().then(() => {
      setStatus((current) => current.state === 'browser'
        ? { state: 'stopped', detail: 'Waiting for backend status' }
        : current);
    });
    const unsubscribe = bridge.onBackendStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.state === 'ready') void refreshConnection();
      if (nextStatus.state === 'failed' || nextStatus.state === 'stopped') setConnection(null);
    });
    return unsubscribe;
  }, [refreshConnection]);

  const runEcho = useCallback(async () => {
    const current = connection || await window.agentDesktop?.getBackendConnection() || null;
    if (!current) {
      setEchoState('failed');
      setEchoDetail('Backend connection is unavailable');
      return;
    }

    setEchoState('running');
    setEchoDetail('Waiting for WebSocket echo');
    const requestId = uuidv4();
    const sessionId = uuidv4();
    const socket = new WebSocket(current.wsUrl, ['agent.v1', current.token]);
    const timeout = window.setTimeout(() => {
      socket.close();
      setEchoState('failed');
      setEchoDetail('Echo timed out');
    }, 5000);

    socket.onopen = () => {
      const event: AgentEvent<{ message: string }> = {
        type: 'diagnostics.echo.request',
        version: '1.0',
        session_id: sessionId,
        request_id: requestId,
        timestamp: new Date().toISOString(),
        data: { message: 'ping' }
      };
      socket.send(JSON.stringify(event));
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as AgentEvent;
        if (event.type !== 'diagnostics.echo.response' || event.request_id !== requestId) {
          throw new Error('Correlation mismatch');
        }
        window.clearTimeout(timeout);
        setEchoState('passed');
        setEchoDetail('WebSocket echo passed');
        socket.close();
      } catch (error) {
        window.clearTimeout(timeout);
        setEchoState('failed');
        setEchoDetail(error instanceof Error ? error.message : 'Invalid echo response');
        socket.close();
      }
    };
    socket.onerror = () => {
      window.clearTimeout(timeout);
      setEchoState('failed');
      setEchoDetail('WebSocket connection failed');
    };
  }, [connection]);

  return (
    <div className="fixed top-16 right-4 z-[80] text-xs">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-md"
        title="后端诊断"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${statusColor[status.state] || statusColor.failed}`} />
        <span>Backend: {status.state}</span>
      </button>
      {expanded && (
        <div className="mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
          <div className="font-bold text-slate-700">Backend diagnostics</div>
          <div className="mt-2 text-slate-500">App {appVersion}</div>
          <div className="mt-1 text-slate-500">Backend {backendVersion}</div>
          <div className="mt-1 break-words text-slate-600">{status.detail}</div>
          <div className="mt-1 text-slate-500">Port: {connection?.port ?? 'n/a'}</div>
          <button
            type="button"
            onClick={() => void runEcho()}
            disabled={!connection || echoState === 'running'}
            className="mt-3 w-full rounded-lg bg-slate-800 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {echoState === 'running' ? 'Testing…' : 'Test WebSocket echo'}
          </button>
          <div className={`mt-2 ${echoState === 'failed' ? 'text-red-600' : echoState === 'passed' ? 'text-emerald-600' : 'text-slate-500'}`}>
            {echoDetail}
          </div>
        </div>
      )}
    </div>
  );
}

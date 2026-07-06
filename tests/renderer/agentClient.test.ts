import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentClient, AgentClientError } from '../../services/agentClient';
import { CatType } from '../../types';

type Listener = (event: any) => void;

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: any[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(public readonly url: string, public readonly protocols: string[]) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    });
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload));
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  receive(payload: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

function response(type: string, requestId: string, data: Record<string, unknown>) {
  return {
    type,
    version: '1.0',
    session_id: 'session-1',
    request_id: requestId,
    timestamp: new Date().toISOString(),
    data
  };
}

function setup(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('window', {
    agentDesktop: {
      getBackendConnection: vi.fn().mockResolvedValue({
        port: 8765,
        token: 'token',
        httpUrl: 'http://127.0.0.1:8765',
        wsUrl: 'ws://127.0.0.1:8765/ws/v1'
      })
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentClient', () => {
  it('routes deltas and resolves the final response', async () => {
    setup();
    const client = new AgentClient();
    const deltas: string[] = [];
    const request = client.sendMessage('session-1', CatType.BLACK, 'Hello', { onDelta: (delta) => { deltas.push(delta); } });
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1));

    const socket = FakeWebSocket.instances[0];
    expect(socket.sent[0].type).toBe('client.message');
    expect(socket.sent[0].data).toEqual({ content: 'Hello', character_id: 'BLACK', interaction_type: 'message' });

    socket.receive(response('assistant.delta', request.requestId, { delta: 'Hi' }));
    socket.receive(response('assistant.delta', request.requestId, { delta: '!' }));
    socket.receive(response('assistant.message', request.requestId, { content: 'Hi!' }));

    await expect(request.completion).resolves.toBe('Hi!');
    expect(deltas).toEqual(['Hi', '!']);
  });

  it('routes confirmation and sends one correlated decision', async () => {
    setup();
    const client = new AgentClient();
    const confirmations: any[] = [];
    const results: any[] = [];
    const request = client.sendMessage('session-1', CatType.BLACK, 'Read file', {
      onToolConfirmation: (confirmation) => confirmations.push(confirmation),
      onToolResult: (result) => results.push(result)
    });
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];

    socket.receive(response('tool.confirmation_required', request.requestId, {
      confirmation_id: 'confirm-1',
      tool_call_id: 'call-1',
      tool_name: 'files.read_text',
      risk_level: 'L2',
      summary: 'Read shared file: note.txt',
      expires_at: new Date(Date.now() + 30_000).toISOString()
    }));
    expect(confirmations).toHaveLength(1);

    client.respondToToolConfirmation('session-1', request.requestId, 'confirm-1', true);
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(socket.sent[1]).toMatchObject({
      type: 'tool.confirmation_response',
      request_id: request.requestId,
      data: { confirmation_id: 'confirm-1', approved: true }
    });

    socket.receive(response('error', request.requestId, {
      error_code: 'INVALID_CONFIRMATION',
      message: 'Expired',
      recoverable: true
    }));
    socket.receive(response('tool.result', request.requestId, {
      tool_call_id: 'call-1',
      tool_name: 'files.read_text',
      status: 'succeeded',
      summary: 'Read shared file: note.txt'
    }));
    expect(results).toHaveLength(1);
    socket.receive(response('assistant.message', request.requestId, { content: 'Done' }));
    await expect(request.completion).resolves.toBe('Done');
  });
  it('sends cancellation for the active correlation id', async () => {
    setup();
    const client = new AgentClient();
    const request = client.sendMessage('session-1', CatType.WHITE, 'Wait');
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1));
    client.cancel('session-1', request.requestId);
    await vi.waitFor(() => expect(FakeWebSocket.instances[0].sent).toHaveLength(2));

    expect(FakeWebSocket.instances[0].sent[1]).toMatchObject({
      type: 'request.cancel',
      session_id: 'session-1',
      request_id: request.requestId
    });
    FakeWebSocket.instances[0].receive(response('request.cancelled', request.requestId, {}));
    await expect(request.completion).rejects.toMatchObject({ errorCode: 'REQUEST_CANCELLED' });
  });

  it('maps agent errors and connection closure to recoverable failures', async () => {
    setup();
    const client = new AgentClient();
    const failed = client.sendMessage('session-1', CatType.BLACK, 'Fail');
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.sent).toHaveLength(1));
    FakeWebSocket.instances[0].receive(response('error', failed.requestId, {
      error_code: 'PROVIDER_TIMEOUT',
      message: 'Timed out',
      recoverable: true
    }));
    await expect(failed.completion).rejects.toEqual(expect.objectContaining({
      errorCode: 'PROVIDER_TIMEOUT',
      recoverable: true
    } satisfies Partial<AgentClientError>));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'interrupted', error_code: 'BACKEND_DISCONNECTED' }), { status: 200 })));
    const disconnected = client.sendMessage('session-1', CatType.BLACK, 'Again');
    await vi.waitFor(() => expect(FakeWebSocket.instances[0].sent).toHaveLength(2));
    FakeWebSocket.instances[0].close();
    await expect(disconnected.completion).rejects.toMatchObject({ errorCode: 'BACKEND_DISCONNECTED' });
  });
});

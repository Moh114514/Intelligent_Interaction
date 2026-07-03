import { v4 as uuidv4 } from 'uuid';
import {
  AgentEvent,
  AgentState,
  ToolConfirmationRequiredData,
  ToolResultData
} from '../generated/contracts';
import { CatType } from '../types';

export class AgentClientError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly recoverable: boolean
  ) {
    super(message);
  }
}

export interface AgentMessageHandlers {
  onDelta?: (text: string) => void;
  onState?: (state: AgentState) => void;
  onToolConfirmation?: (confirmation: ToolConfirmationRequiredData) => void;
  onToolResult?: (result: ToolResultData) => void;
}

interface PendingRequest {
  sessionId: string;
  handlers: AgentMessageHandlers;
  resolve: (content: string) => void;
  reject: (error: AgentClientError) => void;
}

export interface AgentRequest {
  requestId: string;
  completion: Promise<string>;
}

export class AgentClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private pending = new Map<string, PendingRequest>();

  sendMessage(
    sessionId: string,
    characterId: CatType,
    content: string,
    handlers: AgentMessageHandlers = {}
  ): AgentRequest {
    const requestId = uuidv4();
    let resolve!: (content: string) => void;
    let reject!: (error: AgentClientError) => void;
    const completion = new Promise<string>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    this.pending.set(requestId, { sessionId, handlers, resolve, reject });

    void this.ensureSocket()
      .then((socket) => {
        socket.send(JSON.stringify(this.envelope('client.message', sessionId, requestId, {
          content,
          character_id: characterId
        })));
      })
      .catch((error) => {
        this.pending.delete(requestId);
        reject(new AgentClientError('BACKEND_UNAVAILABLE', error instanceof Error ? error.message : 'Backend unavailable', true));
      });

    return { requestId, completion };
  }

  respondToToolConfirmation(sessionId: string, requestId: string, confirmationId: string, approved: boolean): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.sessionId !== sessionId) return;
    void this.ensureSocket().then((socket) => {
      socket.send(JSON.stringify(this.envelope('tool.confirmation_response', sessionId, requestId, {
        confirmation_id: confirmationId,
        approved
      })));
    });
  }

  cancel(sessionId: string, requestId: string): void {
    void this.ensureSocket().then((socket) => {
      socket.send(JSON.stringify(this.envelope('request.cancel', sessionId, requestId, {})));
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
    this.rejectAll('BACKEND_DISCONNECTED', 'Backend connection closed');
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const connection = await window.agentDesktop?.getBackendConnection();
      if (!connection) throw new Error('Backend is not ready');

      const socket = new WebSocket(connection.wsUrl, ['agent.v1', connection.token]);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
      });
      socket.addEventListener('message', (event) => this.handleMessage(event));
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.socket = null;
        this.rejectAll('BACKEND_DISCONNECTED', 'Backend connection closed');
      });
      this.socket = socket;
      return socket;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private handleMessage(message: MessageEvent): void {
    let event: AgentEvent;
    try {
      event = JSON.parse(String(message.data)) as AgentEvent;
    } catch {
      return;
    }
    const pending = this.pending.get(event.request_id);
    if (!pending) return;

    if (event.type === 'agent.state') {
      const state = event.data.state;
      if (typeof state === 'string') pending.handlers.onState?.(state as AgentState);
      return;
    }
    if (event.type === 'assistant.delta') {
      const delta = event.data.delta;
      if (typeof delta === 'string') pending.handlers.onDelta?.(delta);
      return;
    }
    if (event.type === 'tool.confirmation_required') {
      pending.handlers.onToolConfirmation?.(event.data as unknown as ToolConfirmationRequiredData);
      return;
    }
    if (event.type === 'tool.result') {
      pending.handlers.onToolResult?.(event.data as unknown as ToolResultData);
      return;
    }
    if (event.type === 'assistant.message') {
      const content = event.data.content;
      this.pending.delete(event.request_id);
      if (typeof content === 'string') pending.resolve(content);
      else pending.reject(new AgentClientError('INVALID_RESPONSE', 'Assistant response was invalid', true));
      return;
    }
    if (event.type === 'request.cancelled') {
      this.pending.delete(event.request_id);
      pending.reject(new AgentClientError('REQUEST_CANCELLED', 'Request cancelled', true));
      return;
    }
    if (event.type === 'error') {
      if (event.data.error_code === 'INVALID_CONFIRMATION') return;
      this.pending.delete(event.request_id);
      pending.reject(new AgentClientError(
        String(event.data.error_code || 'AGENT_ERROR'),
        String(event.data.message || 'Agent request failed'),
        Boolean(event.data.recoverable)
      ));
    }
  }

  private envelope(type: AgentEvent['type'], sessionId: string, requestId: string, data: Record<string, unknown>): AgentEvent {
    return {
      type,
      version: '1.0',
      session_id: sessionId,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      data
    };
  }

  private rejectAll(errorCode: string, message: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new AgentClientError(errorCode, message, true));
    }
    this.pending.clear();
  }
}
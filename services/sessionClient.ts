import type { PersistedMessage, PersistedRequest, SessionSummary, UserConfig } from '../generated/contracts';

export class SessionClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const connection = await window.agentDesktop?.getBackendConnection();
    if (!connection) throw new Error('后端尚未就绪');
    const response = await fetch(connection.httpUrl + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.token, ...(init.headers || {}) }
    });
    if (!response.ok) throw new Error('会话服务请求失败（' + response.status + '）');
    return response.json() as Promise<T>;
  }
  createSession(id?: string): Promise<SessionSummary> {
    return this.request('/api/v1/sessions', { method: 'POST', body: JSON.stringify({ id }) });
  }
  listSessions(archived = false): Promise<SessionSummary[]> {
    return this.request('/api/v1/sessions?archived=' + archived);
  }
  updateSession(id: string, update: { title?: string; archived?: boolean }): Promise<SessionSummary> {
    return this.request('/api/v1/sessions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(update) });
  }
  messages(id: string): Promise<PersistedMessage[]> {
    return this.request('/api/v1/sessions/' + encodeURIComponent(id) + '/messages');
  }
  config(): Promise<UserConfig> { return this.request('/api/v1/config'); }
  updateConfig(update: Partial<UserConfig>): Promise<UserConfig> {
    return this.request('/api/v1/config', { method: 'PUT', body: JSON.stringify(update) });
  }
  requestStatus(requestId: string): Promise<PersistedRequest> {
    return this.request('/api/v1/requests/' + encodeURIComponent(requestId));
  }
  diagnostics(requestId?: string): Promise<{ schema_version: number; logs: unknown[]; tool_audits: unknown[] }> {
    const query = requestId ? '?request_id=' + encodeURIComponent(requestId) : '';
    return this.request('/api/v1/diagnostics/logs' + query);
  }
}

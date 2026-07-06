import type { LongTermMemory, MemoryCategory, MemoryCreateInput, MemoryPage, MemoryStatus, MemoryUpdateInput } from '../generated/contracts';

export class MemoryClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const connection = await window.agentDesktop?.getBackendConnection();
    if (!connection) throw new Error('后端尚未就绪');
    const response = await fetch(connection.httpUrl + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.token, ...(init.headers || {}) }
    });
    if (!response.ok) {
      let detail = `记忆服务请求失败（${response.status}）`;
      try { detail = (await response.json() as { detail?: string }).detail || detail; } catch { /* ignore invalid error body */ }
      throw new Error(detail);
    }
    return response.json() as Promise<T>;
  }

  list(status: MemoryStatus, limit = 20, offset = 0): Promise<MemoryPage> {
    return this.request(`/api/v1/memories?status=${status}&limit=${limit}&offset=${offset}`);
  }
  create(input: MemoryCreateInput): Promise<LongTermMemory> {
    return this.request('/api/v1/memories', { method: 'POST', body: JSON.stringify(input) });
  }
  update(id: string, input: MemoryUpdateInput): Promise<LongTermMemory> {
    return this.request('/api/v1/memories/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) });
  }
  approve(id: string): Promise<LongTermMemory> {
    return this.request('/api/v1/memories/' + encodeURIComponent(id) + '/approve', { method: 'POST' });
  }
  async delete(id: string): Promise<void> {
    await this.request<{ deleted: boolean }>('/api/v1/memories/' + encodeURIComponent(id), { method: 'DELETE' });
  }
}

export const MEMORY_CATEGORIES: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'profile', label: '个人事实' },
  { value: 'preference', label: '偏好' },
  { value: 'instruction', label: '长期指令' },
  { value: 'project', label: '项目背景' }
];

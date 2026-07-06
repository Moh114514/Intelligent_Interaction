import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionClient } from '../../services/sessionClient';

afterEach(() => { vi.unstubAllGlobals(); });

describe('SessionClient', () => {
  it('authenticates and routes session operations', async () => {
    vi.stubGlobal('window', { agentDesktop: { getBackendConnection: vi.fn().mockResolvedValue({
      httpUrl: 'http://127.0.0.1:8765', wsUrl: '', token: 'token', port: 8765
    }) } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 's1', title: '新会话' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SessionClient();
    await client.createSession('s1');
    await client.listSessions();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/sessions?archived=false');
  });
});

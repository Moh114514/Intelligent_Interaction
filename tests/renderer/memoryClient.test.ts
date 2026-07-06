import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryClient } from '../../services/memoryClient';

afterEach(() => { vi.unstubAllGlobals(); });
describe('MemoryClient', () => {
  it('authenticates list, approval, update and permanent deletion', async () => {
    vi.stubGlobal('window', { agentDesktop: { getBackendConnection: vi.fn().mockResolvedValue({ httpUrl: 'http://127.0.0.1:8765', wsUrl: '', token: 'token', port: 8765 }) } });
    const responses = [
      { items: [], limit: 20, offset: 0, has_more: false },
      { id: 'm1' }, { id: 'm1' }, { deleted: true }
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MemoryClient();
    await client.list('pending'); await client.approve('m1'); await client.update('m1', { pinned: true }); await client.delete('m1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
    expect(fetchMock.mock.calls[0][0]).toContain('status=pending');
    expect(fetchMock.mock.calls[1][0]).toContain('/approve');
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });
});

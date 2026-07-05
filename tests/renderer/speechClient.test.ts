import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechClient, SpeechClientError } from '../../services/speechClient';

afterEach(() => vi.unstubAllGlobals());

function setup(responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { agentDesktop: { getBackendConnection: vi.fn().mockResolvedValue({
    token: 'token', httpUrl: 'http://127.0.0.1:8765', wsUrl: 'ws://127.0.0.1:8765/ws/v1', port: 8765 }) } });
  return fetchMock;
}

describe('SpeechClient', () => {
  it('uploads WAV and downloads one complete TTS asset', async () => {
    const audio = new Uint8Array([82, 73, 70, 70]);
    const fetchMock = setup([
      new Response(JSON.stringify({ text: '你好', language: 'zh-CN', duration_ms: 1000, sample_rate: 16000, channels: 1 }), { status: 200 }),
      new Response(JSON.stringify({ audio_id: 'audio-1', mime_type: 'audio/wav', sample_rate: 24000, channels: 1, expires_at: new Date().toISOString() }), { status: 200 }),
      new Response(audio, { status: 200, headers: { 'Content-Type': 'audio/wav' } })
    ]);
    const client = new SpeechClient();
    expect((await client.transcribe(new Blob([audio]), 'asr-1')).text).toBe('你好');
    expect(new Uint8Array(await client.synthesize('回复', 'BLACK', 'tts-1'))).toEqual(audio);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  });

  it('maps backend errors without hiding recoverability', async () => {
    setup([new Response(JSON.stringify({ error_code: 'ASR_SILENT_AUDIO', message: '没有检测到语音', recoverable: true }), { status: 422 })]);
    await expect(new SpeechClient().transcribe(new Blob(), 'asr')).rejects.toMatchObject({ errorCode: 'ASR_SILENT_AUDIO', recoverable: true });
  });

  it('notifies the backend and aborts an active speech request', async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      if (url.includes('/cancel/')) return Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { agentDesktop: { getBackendConnection: vi.fn().mockResolvedValue({
      token: 'token', httpUrl: 'http://127.0.0.1:8765', wsUrl: 'ws://127.0.0.1:8765/ws/v1', port: 8765 }) } });
    const client = new SpeechClient();
    const pending = client.transcribe(new Blob([new Uint8Array([1])]), 'cancel-me');
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.cancelAll();
    await expect(pending).rejects.toMatchObject({ errorCode: 'SPEECH_CANCELLED' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/cancel/cancel-me'))).toBe(true);
  });});




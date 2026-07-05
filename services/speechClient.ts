import { AsrResponse, CharacterId, TtsResponse } from '../generated/contracts';

export class SpeechClientError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly recoverable = true) { super(message); }
}
interface ActiveRequest { controller: AbortController; connection: BackendConnection; }

export class SpeechClient {
  private active = new Map<string, ActiveRequest>();
  private controllers = new Set<AbortController>();

  async transcribe(wav: Blob, requestId: string): Promise<AsrResponse> {
    const response = await this.request('/api/v1/audio/asr', requestId, { method: 'POST', body: wav,
      headers: { 'Content-Type': 'audio/wav', 'X-Request-ID': requestId } });
    return response.json() as Promise<AsrResponse>;
  }

  async synthesize(text: string, characterId: CharacterId, requestId: string): Promise<ArrayBuffer> {
    const response = await this.request('/api/v1/audio/tts', requestId, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId }, body: JSON.stringify({ text, character_id: characterId }) });
    const metadata = await response.json() as TtsResponse;
    const audio = await this.request(`/api/v1/audio/${encodeURIComponent(metadata.audio_id)}`, null, { method: 'GET' });
    return audio.arrayBuffer();
  }

  cancelAll(): void {
    for (const [requestId, item] of this.active) {
      void fetch(`${item.connection.httpUrl}/api/v1/audio/cancel/${encodeURIComponent(requestId)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${item.connection.token}` }
      }).catch(() => undefined);
    }
    for (const controller of this.controllers) controller.abort();
    this.active.clear();
    this.controllers.clear();
  }

  private async request(path: string, requestId: string | null, init: RequestInit): Promise<Response> {
    const connection = await window.agentDesktop?.getBackendConnection();
    if (!connection) throw new SpeechClientError('BACKEND_UNAVAILABLE', '后端尚未就绪');
    const controller = new AbortController();
    this.controllers.add(controller);
    if (requestId) this.active.set(requestId, { controller, connection });
    try {
      const response = await fetch(`${connection.httpUrl}${path}`, { ...init, signal: controller.signal,
        headers: { Authorization: `Bearer ${connection.token}`, ...(init.headers || {}) } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new SpeechClientError(String(payload.error_code || 'SPEECH_REQUEST_FAILED'), String(payload.message || '语音服务请求失败'), Boolean(payload.recoverable ?? true));
      }
      return response;
    } catch (error) {
      if (error instanceof SpeechClientError) throw error;
      if (controller.signal.aborted) throw new SpeechClientError('SPEECH_CANCELLED', '语音请求已取消');
      throw new SpeechClientError('SPEECH_UNAVAILABLE', '无法连接语音服务');
    } finally {
      this.controllers.delete(controller);
      if (requestId) this.active.delete(requestId);
    }
  }
}

export class PcmRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private inputSampleRate = 48000;
  private starting: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.stream) return;
    if (this.starting) return this.starting;
    this.starting = this.begin();
    try { await this.starting; }
    finally { this.starting = null; }
  }

  private async begin(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境无法访问麦克风');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.inputSampleRate = this.context.sampleRate;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      this.chunks = [];
      this.processor.onaudioprocess = (event) => this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      this.source.connect(this.processor); this.processor.connect(this.sink); this.sink.connect(this.context.destination);
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  async stop(): Promise<Blob> {
    if (this.starting) await this.starting;
    if (!this.stream) throw new Error('录音尚未开始');
    const chunks = this.chunks; const rate = this.inputSampleRate;
    await this.cleanup(); this.chunks = [];
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total); let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    return new Blob([encodeWav(resample(merged, rate, 16000), 16000)], { type: 'audio/wav' });
  }

  async cancel(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    this.chunks = [];
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.processor?.disconnect(); this.source?.disconnect(); this.sink?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.processor = null; this.source = null; this.sink = null; this.stream = null; this.context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}

export function resample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  if (input.length === 0) return new Float32Array();
  const length = Math.max(1, Math.round(input.length * outputRate / inputRate));
  const output = new Float32Array(length); const ratio = inputRate / outputRate;
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio; const left = Math.min(Math.floor(position), input.length - 1); const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left; output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) { const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); }
  return buffer;
}

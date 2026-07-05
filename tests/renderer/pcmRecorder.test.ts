import { afterEach, describe, expect, it, vi } from 'vitest';
import { PcmRecorder, encodeWav, resample } from '../../features/speech/pcmRecorder';

afterEach(() => vi.unstubAllGlobals());

describe('PCM recording helpers', () => {
  it('resamples to 16 kHz and emits mono PCM16 WAV', () => {
    const input = new Float32Array(48000).fill(0.25);
    const output = resample(input, 48000, 16000);
    expect(output).toHaveLength(16000);
    const wav = new Uint8Array(encodeWav(output, 16000));
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000);
    expect(new DataView(wav.buffer).getUint16(22, true)).toBe(1);
    expect(new DataView(wav.buffer).getUint16(34, true)).toBe(16);
  });

  it('waits for microphone startup when stop is requested immediately', async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const streamPromise = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const processor = { ...node(), onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null };
    const gain = { ...node(), gain: { value: 1 } };
    const context = {
      sampleRate: 48000, state: 'running', destination: {}, close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn(() => node()), createScriptProcessor: vi.fn(() => processor), createGain: vi.fn(() => gain)
    };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => streamPromise) } });
    function FakeAudioContext() { return context; }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const recorder = new PcmRecorder();
    const starting = recorder.start();
    const stopping = recorder.stop();
    resolveStream(stream);
    await starting;
    const wav = new Uint8Array(await (await stopping).arrayBuffer());
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });
});

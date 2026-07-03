export interface PcmAudioPayload {
  mimeType: string;
  data: string;
}

export function pcmToBlob(data: Float32Array, sampleRate: number): PcmAudioPayload {
  const int16 = new Int16Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, data[index]));
    int16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return {
    data: encodeBase64(new Uint8Array(int16.buffer)),
    mimeType: `audio/pcm;rate=${sampleRate}`
  };
}

export function decodeBase64(base64: string): Uint8Array {
  let clean = base64.replace(/^data:audio\/\w+;base64,/, '').replace(/\s/g, '');
  clean = clean.replace(/-/g, '+').replace(/_/g, '/');
  while (clean.length % 4) clean += '=';
  const binary = atob(clean);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  context: AudioContext,
  sampleRate = 24000,
  channels = 1
): Promise<AudioBuffer> {
  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const frameCount = Math.floor(samples.length / channels);
  const buffer = context.createBuffer(channels, frameCount, sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const output = buffer.getChannelData(channel);
    for (let index = 0; index < frameCount; index += 1) {
      output[index] = samples[index * channels + channel] / 32768;
    }
  }
  return buffer;
}
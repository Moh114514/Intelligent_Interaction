import { Blob } from '@google/genai';

// Converts Float32 audio buffer from Web Audio API to PCM Int16 Base64 string
export function pcmToBlob(data: Float32Array, sampleRate: number): { mimeType: string, data: string } {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        // Clamp values to [-1, 1]
        const s = Math.max(-1, Math.min(1, data[i]));
        // Convert to 16-bit PCM
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    const buffer = new Uint8Array(int16.buffer);
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    const base64 = btoa(binary);

    return {
        data: base64,
        mimeType: `audio/pcm;rate=${sampleRate}`,
    };
}

export function decodeBase64(base64: string): Uint8Array {
    // Clean the string: remove whitespace, newlines, and data URI prefix if present
    let cleanString = base64
        .replace(/^data:audio\/\w+;base64,/, "")
        .replace(/\s/g, "");

    // Handle URL-safe base64
    cleanString = cleanString.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    while (cleanString.length % 4) {
        cleanString += '=';
    }

    try {
        const binaryString = atob(cleanString);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (e) {
        console.error("Failed to decode base64 string. Length:", cleanString.length, "First 50 chars:", cleanString.substring(0, 50));
        throw e;
    }
}

export function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number = 24000, // Gemini default output
    numChannels: number = 1
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}
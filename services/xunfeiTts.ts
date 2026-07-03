import CryptoJS from 'crypto-js';
import { CatConfig } from '../types';
import { decodeBase64, encodeBase64 } from './audioUtils';

export interface SpeechSynthesisResult {
  audioData: string;
  sampleRate: number;
}

export interface XunfeiTtsConfig {
  appId: string;
  apiKey: string;
  apiSecret: string;
  sparkTTSUrl?: string;
  sparkTTSVcn?: string | { male?: string; female?: string };
}

let configuration: XunfeiTtsConfig | null = null;

export function setSpeechSynthesisConfig(config: XunfeiTtsConfig): void {
  configuration = config;
}

export function getSpeechSynthesisConfig(): XunfeiTtsConfig | null {
  return configuration ? { ...configuration } : null;
}

function authenticatedUrl(url: string, apiKey: string, apiSecret: string): string {
  const parsed = new URL(url);
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${parsed.host}\ndate: ${date}\nGET ${parsed.pathname} HTTP/1.1`;
  const signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(signatureOrigin, apiSecret));
  const authorization = btoa(`api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`);
  return `${url}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${parsed.host}`;
}

function mergeChunks(chunks: Uint8Array[]): string {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return encodeBase64(merged);
}

async function synthesizeSpark(text: string, cat: CatConfig, config: XunfeiTtsConfig): Promise<SpeechSynthesisResult> {
  const endpoint = config.sparkTTSUrl as string;
  const url = authenticatedUrl(endpoint, config.apiKey, config.apiSecret);
  const override = typeof config.sparkTTSVcn === 'string'
    ? config.sparkTTSVcn
    : cat.gender === 'male' ? config.sparkTTSVcn?.male : config.sparkTTSVcn?.female;
  const voice = override || (cat.gender === 'male' ? 'x5_lingfeiyi_flow' : 'x5_lingxiaoxuan_flow');

  const audioData = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url);
    const chunks: Uint8Array[] = [];
    socket.onopen = () => socket.send(JSON.stringify({
      header: { app_id: config.appId, status: 2 },
      parameter: {
        tts: {
          vcn: voice,
          speed: 50,
          volume: 50,
          pitch: 50,
          audio: { encoding: 'raw', sample_rate: 24000, channels: 1, bit_depth: 16, frame_size: 0 }
        }
      },
      payload: {
        text: {
          encoding: 'utf8',
          compress: 'raw',
          format: 'plain',
          status: 2,
          seq: 0,
          text: btoa(unescape(encodeURIComponent(text)))
        }
      }
    }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.header?.code !== 0) {
          socket.close();
          reject(new Error(payload.header?.message || 'Speech synthesis failed'));
          return;
        }
        const chunk = payload.payload?.audio?.audio;
        if (chunk) chunks.push(decodeBase64(chunk));
        if (payload.header?.status === 2) {
          socket.close();
          resolve(mergeChunks(chunks));
        }
      } catch (error) {
        socket.close();
        reject(error);
      }
    };
    socket.onerror = () => reject(new Error('Speech synthesis connection failed'));
  });
  return { audioData, sampleRate: 24000 };
}

async function synthesizeStandard(text: string, cat: CatConfig, config: XunfeiTtsConfig): Promise<SpeechSynthesisResult> {
  const url = authenticatedUrl('wss://tts-api.xfyun.cn/v2/tts', config.apiKey, config.apiSecret);
  const voice = cat.gender === 'male' ? 'aisjiuxu' : 'xiaoyan';
  const audioData = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(url);
    const chunks: Uint8Array[] = [];
    socket.onopen = () => socket.send(JSON.stringify({
      common: { app_id: config.appId },
      business: { aue: 'raw', auf: 'audio/L16;rate=16000', vcn: voice, tte: 'UTF8', speed: 50, volume: 80, pitch: 50 },
      data: { status: 2, text: btoa(unescape(encodeURIComponent(text))) }
    }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.code !== 0) {
          socket.close();
          reject(new Error(payload.message || 'Speech synthesis failed'));
          return;
        }
        if (payload.data?.audio) chunks.push(decodeBase64(payload.data.audio));
        if (payload.data?.status === 2) {
          socket.close();
          resolve(mergeChunks(chunks));
        }
      } catch (error) {
        socket.close();
        reject(error);
      }
    };
    socket.onerror = () => reject(new Error('Speech synthesis connection failed'));
  });
  return { audioData, sampleRate: 16000 };
}

export async function synthesizeSpeech(text: string, cat: CatConfig): Promise<SpeechSynthesisResult | null> {
  if (!configuration) return null;
  if (configuration.sparkTTSUrl) {
    try {
      return await synthesizeSpark(text, cat, configuration);
    } catch (error) {
      console.warn('Primary speech synthesis failed; using standard voice.', error);
    }
  }
  return synthesizeStandard(text, cat, configuration);
}
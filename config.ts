import { API_CREDENTIALS } from './api.config';
import { ISpeechService, BrowserSpeechService, XunfeiSpeechService } from './services/speechRecognition';
import { getSpeechSynthesisConfig, setSpeechSynthesisConfig } from './services/xunfeiTts';

type RuntimeConfig = {
  xunfei?: {
    sparkTTSVcnMale?: string;
    sparkTTSVcnFemale?: string;
    sparkTTSUrl?: string;
  };
};

async function loadRuntimeConfig(): Promise<void> {
  try {
    const response = await fetch('./runtime-config.json', { cache: 'no-store' });
    if (!response.ok) return;
    const runtime = (await response.json()) as RuntimeConfig;
    const current = getSpeechSynthesisConfig();
    if (!runtime.xunfei || !current) return;
    setSpeechSynthesisConfig({
      ...current,
      sparkTTSUrl: runtime.xunfei.sparkTTSUrl ?? current.sparkTTSUrl,
      sparkTTSVcn: {
        male: runtime.xunfei.sparkTTSVcnMale,
        female: runtime.xunfei.sparkTTSVcnFemale
      }
    });
  } catch (error) {
    console.warn('Runtime speech configuration could not be loaded.', error);
  }
}

export function initializeAppConfig(): void {
  const credentials = API_CREDENTIALS.xunfei;
  if (credentials.appId && !credentials.appId.startsWith('YOUR_')) {
    setSpeechSynthesisConfig({
      appId: credentials.appId,
      apiSecret: credentials.apiSecret,
      apiKey: credentials.apiKey,
      sparkTTSUrl: 'wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6',
      sparkTTSVcn: { male: 'x5_lingfeiyi_flow', female: 'x5_lingxiaoxuan_flow' }
    });
    void loadRuntimeConfig();
  }
}

export function createCustomSpeechService(): ISpeechService {
  const credentials = API_CREDENTIALS.xunfei;
  if (!credentials.appId || credentials.appId.startsWith('YOUR_')) {
    return new BrowserSpeechService();
  }
  return new XunfeiSpeechService({
    appId: credentials.appId,
    apiSecret: credentials.apiSecret,
    apiKey: credentials.apiKey,
    url: 'wss://iat-api.xfyun.cn/v2/iat',
    domain: 'iat'
  });
}
/**
 * ====================================================================
 * 项目全局配置文件
 * ====================================================================
 * 
 * 这里是配置所有 API 接入的地方。
 * 只需要修改 initializeAppConfig 函数中的内容即可生效。
 */

import { getApiConfig, setApiConfig } from './services/geminiService';
import { RestApiSpeechService, ISpeechService, XunfeiSpeechService } from './services/speechRecognition';
import { API_CREDENTIALS } from './api.config';

type RuntimeConfig = {
    xunfei?: {
        /** 覆盖星火超拟人发音人（男/女） */
        sparkTTSVcnMale?: string;
        sparkTTSVcnFemale?: string;
        /** 可选：覆盖星火超拟人 WebSocket 地址 */
        sparkTTSUrl?: string;
    };
};

async function loadRuntimeConfig() {
    try {
        const res = await fetch('./runtime-config.json', { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = (await res.json()) as RuntimeConfig;
        if (!cfg?.xunfei) return;

        const current = getApiConfig();
        if (!current.xunfeiConfig) return;

        const { sparkTTSVcnMale, sparkTTSVcnFemale, sparkTTSUrl } = cfg.xunfei;
        const hasVcnOverride = Boolean(sparkTTSVcnMale || sparkTTSVcnFemale);

        const nextXunfeiConfig: any = {
            ...current.xunfeiConfig,
            sparkTTSUrl: sparkTTSUrl ?? current.xunfeiConfig.sparkTTSUrl,
        };
        if (hasVcnOverride) {
            nextXunfeiConfig.sparkTTSVcn = { male: sparkTTSVcnMale, female: sparkTTSVcnFemale };
        }

        setApiConfig({ xunfeiConfig: nextXunfeiConfig });

        console.log('[runtime-config] loaded');
    } catch (e) {
        // 读取失败时静默忽略，继续使用代码内默认值
        console.warn('[runtime-config] load failed:', e);
    }
}

/**
 * ✅ 【在此处修改配置】
 * 应用启动时会自动调用此函数
 */
export function initializeAppConfig() {
    console.log("Initializing App Configuration...");

    // ----------------------------------------------------------------
    // 1. 配置文本生成与语音合成 (LLM + TTS)
    // ----------------------------------------------------------------
    
    // 方式 A: 使用官方 Gemini API (默认)
    // 只要环境变量中有 API_KEY 即可，无需额外代码
    configForGeminiOfficial();

    // 方式 B: 使用 OpenAI 兼容接口 (DeepSeek, Moonshot, LocalAI 等)
    // 取消下面这行的注释来启用：
    // configForOpenAICompatible();

    // 方式 C: 使用自建代理服务器
    // 取消下面这行的注释来启用：
    // configForProxyServer();

    // 方式 D: 使用科大讯飞 TTS (语音合成)
    // 取消下面这行的注释来启用：
    configForXunfeiTTS();

    // ----------------------------------------------------------------
    // 2. 配置语音识别 (ASR)
    // ----------------------------------------------------------------
    // 注意：语音识别的配置目前需要在 App.tsx 中引用 createCustomSpeechService
    // 这里仅提供工厂函数供 App.tsx 使用

    // ----------------------------------------------------------------
    // 3. 运行时配置覆盖（打包后可改音色）
    // ----------------------------------------------------------------
    void loadRuntimeConfig();
}

/**
 * 供 App.tsx 调用的语音服务工厂函数
 * 如果你想用第三方语音识别，请修改这里的返回值
 */
export function createCustomSpeechService(): ISpeechService | null {
    // 如果返回 null，App 将使用浏览器默认语音识别
    // return null;

    // 示例：返回讯飞语音识别服务
    // 请替换为你自己的 APPID, APISecret, APIKey
    return new XunfeiSpeechService({
        appId: API_CREDENTIALS.xunfei.appId,
        apiSecret: API_CREDENTIALS.xunfei.apiSecret,
        apiKey: API_CREDENTIALS.xunfei.apiKey,
        
        // ✅ 如果要使用【中文识别大模型】或【星火语音识别】：
        // 1. 请在讯飞控制台开通对应服务
        // 2. 确认 AppID/APIKey/APISecret 是否有变化
        // 3. 填写对应的 WebSocket 接口地址 (wss://...)
        // 常用地址：
        // 语音听写 (IAT): wss://iat-api.xfyun.cn/v2/iat
        // 语音识别大模型 (Spark ASR): wss://spark-api.xfyun.cn/v2.1/asr
        // 注意：大模型可能需要 domain 参数为 'pro_ost_ed' 或其他，具体请查阅文档
        
        // ⚠️ 暂时回退到标准 IAT 地址，因为 Spark ASR 连接失败（可能是未授权或参数错误）
        // 如果您确认已开通 Spark ASR，请取消下面注释并填入正确 URL
        // url: "wss://spark-api.xfyun.cn/v2.1/asr", 
        url: "wss://iat-api.xfyun.cn/v2/iat",
        domain: "iat",
    });

    // 示例：返回 OpenAI Whisper 服务
    /*
    return new RestApiSpeechService({
        apiUrl: "https://api.openai.com/v1/audio/transcriptions",
        apiKey: "sk-...",
        model: "whisper-1",
        language: "zh"
    });
    */
}


// ====================================================================
// 下面是具体的配置实现细节，通常不需要修改
// ====================================================================

function configForGeminiOfficial() {
    // 默认行为，无需特殊配置
    // 可以在这里设置全局超时等
    setApiConfig({ timeout: 30000 });
}

function configForProxyServer() {
    setApiConfig({
        proxyBaseUrl: "https://your-proxy-server.com/api",
        customHeaders: {
            "X-App-Token": "your-app-token"
        }
    });
}

function configForOpenAICompatible() {
    setApiConfig({
        useCustomHandler: true,
        proxyBaseUrl: "https://api.deepseek.com/v1", 
        apiKey: "sk-...", 
        customHeaders: {
            "Content-Type": "application/json"
        }
    });
}

function configForXunfeiTTS() {
    setApiConfig({
        useCustomHandler: true,
        // 配置 DeepSeek 作为文本生成模型
        proxyBaseUrl: "https://api.deepseek.com/v1", 
        apiKey: API_CREDENTIALS.deepSeek.apiKey,
        
        // 配置讯飞作为语音合成服务
        xunfeiConfig: {
            appId: API_CREDENTIALS.xunfei.appId,
            apiSecret: API_CREDENTIALS.xunfei.apiSecret,
            apiKey: API_CREDENTIALS.xunfei.apiKey,
            // 星火超拟人合成配置 - 两只猫都启用
            sparkTTSUrl: "wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6",
            sparkTTSVcn: undefined, // 根据性别自动选择发音人
            // 黑猫: x5_lingfeiyi_flow (男声)
            // 白猫: x5_lingxiaotang_flow (女声)
        }
    });
}


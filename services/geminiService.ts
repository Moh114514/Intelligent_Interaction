import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { CatConfig } from "../types";
import { decodeAudioData, decodeBase64, encodeBase64, pcmToBlob } from "./audioUtils";
import { LIVE_MODEL_NAME, TEXT_MODEL_NAME, TTS_MODEL_NAME } from "../constants";
import CryptoJS from 'crypto-js';

// 讯飞 TTS 鉴权 URL 生成函数
function getXunfeiTTSUrl(apiKey: string, apiSecret: string): string {
    const url = 'wss://tts-api.xfyun.cn/v2/tts';
    const host = 'tts-api.xfyun.cn';
    const date = new Date().toUTCString();
    const algorithm = 'hmac-sha256';
    const headers = 'host date request-line';
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`;
    const signatureSha = CryptoJS.HmacSHA256(signatureOrigin, apiSecret);
    const signature = CryptoJS.enc.Base64.stringify(signatureSha);
    const authorizationOrigin = `api_key="${apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`;
    const authorization = btoa(authorizationOrigin);
    return `${url}?authorization=${authorization}&date=${date}&host=${host}`;
}

// 讯飞星火超拟人 TTS 鉴权 URL 生成函数
function getSparkTTSUrl(urlStr: string, apiKey: string, apiSecret: string): string {
    const urlObj = new URL(urlStr);
    const host = urlObj.host;
    const path = urlObj.pathname;
    
    const date = new Date().toUTCString();
    const algorithm = 'hmac-sha256';
    const headers = 'host date request-line';
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    
    const signatureSha = CryptoJS.HmacSHA256(signatureOrigin, apiSecret);
    const signature = CryptoJS.enc.Base64.stringify(signatureSha);
    const authorizationOrigin = `api_key="${apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`;
    const authorization = btoa(authorizationOrigin);
    
    return `${urlStr}?authorization=${authorization}&date=${date}&host=${host}`;
}

/**
 * ====================================================================
 * 第三方服务接入配置说明
 * ====================================================================
 * 
 * 本模块支持以下三种接入方式：
 * 
 * 1. 【直接使用 Google Gemini API】（默认）
 *    - 使用 @google/genai SDK
 *    - API Key 从环境变量或 window.aistudio 获取
 *    - 适合：直接调用 Google 服务
 * 
 * 2. 【通过自建代理服务器】（推荐生产环境）
 *    - 设置 API_PROXY_BASE_URL 指向你的代理服务器
 *    - 代理服务器转发请求到 Gemini 或其他兼容 API
 *    - 优点：API Key 不暴露在前端，可以添加鉴权、限流等
 *    - 示例代理实现见文件末尾注释
 * 
 * 3. 【使用第三方兼容 API】
 *    - 例如：OpenAI GPT、Azure OpenAI、自部署的模型等
 *    - 需要实现兼容的 REST 接口
 *    - 设置 USE_CUSTOM_API_HANDLER = true
 *    - 参考 customApiHandlers 中的实现示例
 * 
 * 配置方法：
 * - 在项目根目录创建 .env 文件（Vite 会自动加载）
 * - 或在 vite.config.ts 中配置 define 字段
 * - 或直接修改下方的配置对象
 */

/**
 * API 服务配置接口
 */
interface ApiServiceConfig {
    // 是否使用自定义 API 处理器（非 Gemini SDK）
    useCustomHandler: boolean;
    
    // API 代理服务器地址（可选）
    // 例如："https://your-proxy-server.com/api"
    proxyBaseUrl?: string;
    
    // API Key（优先从环境变量读取）
    apiKey?: string;
    
    // 自定义请求头（用于鉴权、跟踪等）
    customHeaders?: Record<string, string>;
    
    // 超时设置（毫秒）
    timeout?: number;

    // 讯飞配置（可选）
    xunfeiConfig?: {
        appId: string;
        apiKey: string;
        apiSecret: string;
        sparkTTSUrl?: string;
        /**
         * 星火超拟人发音人：
         * - string：两只猫统一使用同一个 vcn
         * - object：可按性别分别指定 vcn
         */
        sparkTTSVcn?: string | { male?: string; female?: string };
    };
}

/**
 * 全局配置对象
 * 可以在应用启动时通过 setApiConfig() 修改
 */
let apiConfig: ApiServiceConfig = {
    useCustomHandler: false,
    proxyBaseUrl: process.env.API_PROXY_BASE_URL,
    apiKey: process.env.API_KEY,
    timeout: 30000,
    customHeaders: {},
    xunfeiConfig: undefined
};

/**
 * 设置 API 配置（应用启动时调用）
 * @example
 * // 配置使用代理服务器
 * setApiConfig({
 *   proxyBaseUrl: "https://my-proxy.com/api",
 *   customHeaders: { "X-User-Token": "your-user-token" }
 * });
 * 
 * @example
 * // 配置使用自定义 API（如 OpenAI）
 * setApiConfig({
 *   useCustomHandler: true,
 *   apiKey: "sk-...",
 *   proxyBaseUrl: "https://api.openai.com/v1"
 * });
 */
export function setApiConfig(config: Partial<ApiServiceConfig>) {
    apiConfig = { ...apiConfig, ...config };
}

/**
 * 获取当前 API 配置
 */
export function getApiConfig(): ApiServiceConfig {
    return { ...apiConfig };
}

// Always create a new client to ensure we use the most up-to-date API_KEY
const getAiClient = () => {
    const apiKey = apiConfig.apiKey || process.env.API_KEY;
    
    if (!apiKey) {
        console.error("API_KEY is missing");
        throw new Error("API Key missing. Please set API_KEY in environment or call setApiConfig()");
    }
    
    // 如果配置了代理，可以在这里设置 baseURL（需要 SDK 支持）
    const clientOptions: any = { apiKey };
    if (apiConfig.proxyBaseUrl) {
        // 注意：@google/genai SDK 可能不直接支持 baseURL
        // 如需代理，建议使用 useCustomHandler 模式
        console.warn("Proxy URL configured but @google/genai SDK may not support baseURL override. Consider using useCustomHandler mode.");
    }
    
    return new GoogleGenAI(clientOptions);
};

// --- Text to Audio (Turn-based) ---

/**
 * 发送文本消息并获取 AI 回复（文本 + 音频）
 * 
 * 支持的接入方式：
 * 1. Gemini API（默认）- 使用 generateContent + TTS
 * 2. 自定义 API - 通过 customApiHandlers.textToSpeech 实现
 * 3. 代理服务器 - 请求会通过配置的 proxyBaseUrl
 * 
 * @param text - 用户输入的文本
 * @param catConfig - 角色配置（包含 systemInstruction、voiceName 等）
 * @returns Promise<{ audioData: string; text: string }> - Base64 音频数据和回复文本
 * 
 * @example
 * // 使用默认 Gemini API
 * const result = await sendTextMessage("你好", BLACK_CAT_CONFIG);
 * 
 * @example
 * // 使用自定义 API（需先配置）
 * setApiConfig({ useCustomHandler: true, proxyBaseUrl: "https://my-api.com" });
 * const result = await sendTextMessage("Hello", BLACK_CAT_CONFIG);
 */
export async function sendTextMessage(
    text: string, 
    catConfig: CatConfig,
    history: any[] = []
): Promise<{ audioData: string; text: string }> {
    // 如果配置了自定义处理器，使用自定义实现
    if (apiConfig.useCustomHandler) {
        return await customApiHandlers.textToSpeech(text, catConfig, apiConfig, history);
    }
    
    // 默认使用 Gemini SDK
    const ai = getAiClient();
    
    try {
        // Step 1: Get Text Response from Intelligence Model
        // 这里调用文本生成模型获取 AI 回复
        const textResponseResult = await ai.models.generateContent({
            model: TEXT_MODEL_NAME,
            contents: {
                role: 'user',
                parts: [{ text }]
            },
            config: {
                systemInstruction: catConfig.systemInstruction,
                thinkingConfig: { thinkingBudget: 0 }, // Low latency for text
            }
        });

        const responseText = textResponseResult.candidates?.[0]?.content?.parts?.[0]?.text || "Meow!";

        // Step 2: Generate Audio from TTS Model
        // 将 AI 的文本回复转换为语音
        const ttsResponse = await ai.models.generateContent({
            model: TTS_MODEL_NAME,
            contents: {
                parts: [{ text: responseText }]
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: catConfig.voiceName },
                    },
                },
            },
        });

        const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        const audioBase64 = audioPart?.inlineData?.data || '';
        
        return {
            audioData: audioBase64,
            text: responseText
        };

    } catch (error) {
        console.error("Error generating content:", error);
        throw error;
    }
}


// --- Live API (Streaming) ---

/**
 * 实时会话回调接口
 */
interface LiveSessionCallbacks {
    /** 接收到音频数据时调用 */
    onAudioData: (buffer: AudioBuffer) => void;
    /** 接收到转录文本时调用 */
    onTextTranscript: (text: string, role: 'user' | 'model') => void;
    /** AI 完成一轮对话时调用 */
    onTurnComplete: () => void;
    /** 连接关闭时调用 */
    onClose: () => void;
}

/**
 * 实时语音会话管理器
 * 
 * 支持的接入方式：
 * 1. Gemini Live API（默认）- WebSocket 实时双向音频流
 * 2. 自定义 WebSocket 服务 - 实现兼容的协议
 * 3. WebRTC 方案 - 通过自定义实现替换
 * 
 * 接入第三方服务的步骤：
 * 1. 实现兼容的 WebSocket 协议或使用适配器模式
 * 2. 修改 connect() 方法中的连接逻辑
 * 3. 调整消息格式转换（handleMessage）
 * 4. 确保音频格式兼容（PCM 16kHz 单声道）
 * 
 * 示例：接入自定义 WebSocket 服务
 * ```typescript
 * // 在 connect() 中替换连接逻辑
 * const ws = new WebSocket('wss://your-service.com/live');
 * ws.onmessage = (event) => {
 *   const data = JSON.parse(event.data);
 *   this.handleCustomMessage(data);
 * };
 * ```
 */
export class LiveSessionManager {
    private session: any = null; 
    private inputAudioContext: AudioContext;
    private outputAudioContext: AudioContext;
    private processor: ScriptProcessorNode | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private stream: MediaStream | null = null;
    private catConfig: CatConfig;
    private callbacks: LiveSessionCallbacks;
    private isConnected: boolean = false;
    private hasRecordedData: boolean = false;
    
    constructor(catConfig: CatConfig, callbacks: LiveSessionCallbacks) {
        this.catConfig = catConfig;
        this.callbacks = callbacks;
        // Input must match the rate sent to API (16kHz recommended for Gemini)
        this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    public async connect() {
        if (this.isConnected && this.session) return;

        // 如果启用了自定义处理器（如 DeepSeek + 讯飞），则不支持 Live API（WebSocket 流式）
        // 因为目前自定义处理器只实现了 textToSpeech (REST/TTS)，没有实现双向实时流
        if (apiConfig.useCustomHandler) {
            console.warn("Live API is not supported in Custom Handler mode (e.g. DeepSeek + Xunfei). Please use the microphone button (External ASR) instead.");
            // 模拟连接失败或直接返回，避免尝试连接 Gemini Live
            this.callbacks.onClose();
            return;
        }

        const ai = getAiClient();
        
        try {
            // NOTE: thinkingConfig is NOT supported in Live API connect config and causes 503 errors.
            this.session = await ai.live.connect({
                model: LIVE_MODEL_NAME,
                callbacks: {
                    onopen: () => {
                        console.log("Live API Connected");
                        this.isConnected = true;
                    },
                    onmessage: this.handleMessage.bind(this),
                    onclose: () => {
                        console.log("Live API Closed");
                        this.isConnected = false;
                        this.callbacks.onClose();
                    },
                    onerror: (e: any) => {
                        console.error("Live API Error", e);
                        this.isConnected = false;
                        this.callbacks.onClose(); // Ensure UI resets on error
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: this.catConfig.voiceName } }
                    },
                    systemInstruction: this.catConfig.systemInstruction,
                    inputAudioTranscription: { },
                    outputAudioTranscription: { }
                }
            });
        } catch (error) {
            console.error("Failed to connect to Live API:", error);
            this.isConnected = false;
            this.callbacks.onClose();
            throw error;
        }
    }

    private async handleMessage(message: LiveServerMessage) {
        // Handle Audio Output
        const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData) {
            try {
                const buffer = await decodeAudioData(
                    decodeBase64(audioData), 
                    this.outputAudioContext
                );
                this.callbacks.onAudioData(buffer);
            } catch (e) {
                console.error("Decoding error", e);
            }
        }

        // Handle Transcripts
        if (message.serverContent?.inputTranscription?.text) {
            this.callbacks.onTextTranscript(message.serverContent.inputTranscription.text, 'user');
        }
        if (message.serverContent?.outputTranscription?.text) {
            this.callbacks.onTextTranscript(message.serverContent.outputTranscription.text, 'model');
        }

        // Handle Turn Completion
        if (message.serverContent?.turnComplete) {
            this.callbacks.onTurnComplete();
        }
    }

    public async startRecording() {
        // Ensure connection
        try {
            if (!this.session || !this.isConnected) {
                await this.connect();
            }

            // Reset data flag
            this.hasRecordedData = false;

            // Browser requires user interaction to resume AudioContext
            if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
            if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

            // 检查 navigator.mediaDevices 是否存在（安全上下文检查）
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("麦克风访问失败：请确保使用 HTTPS 或 localhost 访问，并允许麦克风权限。");
            }

            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.source = this.inputAudioContext.createMediaStreamSource(this.stream);
            // Use smaller buffer size (2048) for more frequent updates and less latency
            this.processor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Mark that we have processed some audio
                this.hasRecordedData = true;

                // Correctly format PCM data for the API
                const payload = pcmToBlob(inputData, 16000);
                
                if (this.session && this.isConnected) {
                     this.session.sendRealtimeInput({ media: payload });
                }
            };

            this.source.connect(this.processor);
            this.processor.connect(this.inputAudioContext.destination);
        } catch (err) {
            console.error("Error starting microphone", err);
            // Ensure we clean up if start fails
            this.isConnected = false;
            this.callbacks.onClose();
            throw err;
        }
    }

    public stopRecording(): boolean {
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        // Return true if we actually sent some data
        return this.hasRecordedData;
    }

    public async disconnect() {
        this.stopRecording();
        if (this.session) {
            this.session = null;
        }
        this.isConnected = false;
        // Close contexts to free hardware resources
        if (this.inputAudioContext.state !== 'closed') await this.inputAudioContext.close();
        if (this.outputAudioContext.state !== 'closed') await this.outputAudioContext.close();
    }
}

/**
 * ====================================================================
 * 自定义 API 处理器实现示例
 * ====================================================================
 * 
 * 以下代码展示如何接入第三方 API 服务（OpenAI、Azure、自建服务等）
 * 根据你的实际需求修改这些函数
 */

/**
 * 自定义 API 处理器接口
 */
interface CustomApiHandlers {
    /**
     * 文本转语音的自定义实现
     * 
     * 接入示例：
     * - OpenAI TTS: POST https://api.openai.com/v1/audio/speech
     * - Azure Speech: https://docs.microsoft.com/azure/cognitive-services/speech-service/
     * - 自建 TTS 服务
     * 
     * @example OpenAI TTS
     * ```typescript
     * const response = await fetch(`${config.proxyBaseUrl}/audio/speech`, {
     *   method: 'POST',
     *   headers: {
     *     'Authorization': `Bearer ${config.apiKey}`,
     *     'Content-Type': 'application/json'
     *   },
     *   body: JSON.stringify({
     *     model: 'tts-1',
     *     input: responseText,
     *     voice: 'alloy'
     *   })
     * });
     * const audioBlob = await response.blob();
     * const arrayBuffer = await audioBlob.arrayBuffer();
     * const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
     * return { audioData: base64, text: responseText };
     * ```
     */
    textToSpeech: (
        text: string,
        catConfig: CatConfig,
        config: ApiServiceConfig,
        history?: any[]
    ) => Promise<{ audioData: string; text: string }>;
}

/**
 * 自定义处理器实现
 * 根据你使用的第三方服务修改这里的代码
 */
const customApiHandlers: CustomApiHandlers = {
    /**
     * 文本转语音 - 第三方 API 实现示例
     * 
     * 配置步骤：
     * 1. 取消下方注释并根据你的 API 修改
     * 2. 在 App 启动时调用 setApiConfig({ useCustomHandler: true })
     * 3. 设置正确的 proxyBaseUrl 和 apiKey
     */
    textToSpeech: async (text, catConfig, config, history = []) => {
        // 1. 获取文本回复 (LLM)
        let responseText = "Meow!";
        
        // 如果配置了 proxyBaseUrl，尝试调用兼容 OpenAI 的 LLM (如 DeepSeek)
        if (config.proxyBaseUrl && config.apiKey) {
            try {
                // 构建上下文消息
                const messages = [
                    { role: 'system', content: catConfig.systemInstruction },
                    ...history.map(msg => ({
                        role: msg.role === 'model' ? 'assistant' : 'user',
                        content: msg.text
                    })),
                    { role: 'user', content: text }
                ];

                const chatResponse = await fetch(`${config.proxyBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.apiKey}`,
                        'Content-Type': 'application/json',
                        ...config.customHeaders
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat', // 默认尝试 deepseek-chat，也可以在 config 中指定
                        messages: messages,
                        temperature: 0.7
                    })
                });

                if (chatResponse.ok) {
                    const chatData = await chatResponse.json();
                    responseText = chatData.choices?.[0]?.message?.content || responseText;
                } else {
                    console.warn("LLM Request failed, falling back to default text.", chatResponse.status);
                }
            } catch (e) {
                console.error("LLM Error:", e);
            }
        } else {
            // 如果没有配置 LLM，直接回显（或者这里可以回退到 Gemini）
            // 为了简单，这里假设如果用了讯飞 TTS 但没配 LLM，就直接读出用户的输入（或简单的回复）
            // 实际建议：混合模式下必须配置 LLM
            console.warn("No LLM configured for text generation. Using placeholder.");
        }

        // 2. 生成语音 (TTS)
        // ===== 讯飞 TTS 实现 =====
        if (config.xunfeiConfig) {
            const { appId, apiKey, apiSecret, sparkTTSUrl, sparkTTSVcn } = config.xunfeiConfig;
            
            // --- 分支：星火超拟人合成（两只猫都启用）---
            if (sparkTTSUrl) {
                try {
                    const url = getSparkTTSUrl(sparkTTSUrl, apiKey, apiSecret);
                    // 根据角色性别自动选择发音人（支持按性别覆盖）
                    const vcnOverride = typeof sparkTTSVcn === 'string'
                        ? sparkTTSVcn
                        : (catConfig.gender === 'male' ? sparkTTSVcn?.male : sparkTTSVcn?.female);
                    const vcn = vcnOverride || (catConfig.gender === 'male' ? "x5_lingfeiyi_flow" : "x5_lingxiaoxuan_flow");
                    const isX5 = vcn.startsWith('x5');
                    console.log(`使用星火超拟人合成 - 发音人: ${vcn}, 角色: ${catConfig.name}`);

                    const audioData = await new Promise<string>((resolve, reject) => {
                        const ws = new WebSocket(url);
                        const audioChunks: Uint8Array[] = [];
                        
                        ws.onopen = () => {
                            const params: any = {
                                header: {
                                    app_id: appId,
                                    status: 2
                                },
                                parameter: {
                                    tts: {
                                        vcn: vcn,
                                        speed: 50,
                                        volume: 50,
                                        pitch: 50,
                                        audio: {
                                            encoding: "raw",
                                            sample_rate: 24000, // 推荐 24k
                                            channels: 1,
                                            bit_depth: 16,
                                            frame_size: 0
                                        }
                                    }
                                },
                                payload: {
                                    text: {
                                        encoding: "utf8",
                                        compress: "raw",
                                        format: "plain",
                                        status: 2,
                                        seq: 0,
                                        text: btoa(unescape(encodeURIComponent(responseText)))
                                    }
                                }
                            };

                            // 仅非 x5 系列才添加 oral 参数
                            if (!isX5) {
                                params.parameter.oral = {
                                    oral_level: "mid",
                                    spark_assist: 1,
                                    stop_split: 0,
                                    remain: 0
                                };
                            }

                            ws.send(JSON.stringify(params));
                        };

                        ws.onmessage = (e) => {
                            let jsonData;
                            try {
                                jsonData = JSON.parse(e.data);
                            } catch (err) {
                                console.error("JSON Parse Error", err);
                                return;
                            }

                            if (jsonData.header.code !== 0) {
                                ws.close();
                                console.error("讯飞星火 TTS 详细错误:", {
                                    code: jsonData.header.code,
                                    message: jsonData.header.message,
                                    vcn: vcn,
                                    appId: appId,
                                    url: sparkTTSUrl
                                });
                                reject(`讯飞星火 TTS 错误 [${jsonData.header.code}]: ${jsonData.header.message}`);
                                return;
                            }
                            
                            if (jsonData.payload && jsonData.payload.audio && jsonData.payload.audio.audio) {
                                try {
                                    const chunk = decodeBase64(jsonData.payload.audio.audio);
                                    audioChunks.push(chunk);
                                } catch (err) {
                                    console.error("Error decoding TTS chunk", err);
                                }
                            }
                            
                            if (jsonData.header.status === 2) {
                                ws.close();
                                // Merge chunks
                                const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
                                const mergedAudio = new Uint8Array(totalLength);
                                let offset = 0;
                                for (const chunk of audioChunks) {
                                    mergedAudio.set(chunk, offset);
                                    offset += chunk.length;
                                }
                                // Convert back to base64 for return
                                let binary = '';
                                const len = mergedAudio.byteLength;
                                const CHUNK_SIZE = 8192;
                                for (let i = 0; i < len; i += CHUNK_SIZE) {
                                    binary += String.fromCharCode.apply(null, Array.from(mergedAudio.subarray(i, Math.min(i + CHUNK_SIZE, len))));
                                }
                                resolve(btoa(binary));
                            }
                        };

                        ws.onerror = (e) => reject(e);
                    });
                    
                    return { audioData, text: responseText };
                } catch (error) {
                    console.warn("星火超拟人 TTS 失败，尝试降级到标准 TTS:", error);
                    // 不返回，继续执行下方的标准 TTS 逻辑
                }
            }

            // --- 分支：旧版 TTS ---
            const url = getXunfeiTTSUrl(apiKey, apiSecret);
            
            const audioData = await new Promise<string>((resolve, reject) => {
                const ws = new WebSocket(url);
                // Store binary chunks instead of concatenating base64 strings
                // Concatenating base64 strings is unsafe because of potential padding characters in the middle
                const audioChunks: Uint8Array[] = [];
                
                ws.onopen = () => {
                    const params = {
                        common: { app_id: appId },
                        business: {
                            aue: "raw", // PCM
                            auf: "audio/L16;rate=16000",
                            // 讯飞标准发音人配置（分别优化）
                            // 黑猫（男声）: xiaofeng（小峰）
                            // 白猫（女声）: xiaoyan（小燕，温柔女声）
                            vcn: catConfig.gender === 'male' ? "xiaofeng" : "xiaoyan", 
                            tte: "UTF8"
                        },
                        data: {
                            status: 2,
                            text: btoa(unescape(encodeURIComponent(responseText))) // 使用生成的文本
                        }
                    };
                    ws.send(JSON.stringify(params));
                };

                ws.onmessage = (e) => {
                    const jsonData = JSON.parse(e.data);
                    if (jsonData.code !== 0) {
                        ws.close();
                        reject(`讯飞 TTS 错误: ${jsonData.code} ${jsonData.message}`);
                        return;
                    }
                    
                    if (jsonData.data && jsonData.data.audio) {
                        // Decode each chunk immediately
                        try {
                            const chunk = decodeBase64(jsonData.data.audio);
                            audioChunks.push(chunk);
                        } catch (err) {
                            console.error("Error decoding TTS chunk", err);
                        }
                    }
                    
                    if (jsonData.data && jsonData.data.status === 2) {
                        ws.close();
                        // Merge chunks
                        const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
                        const mergedAudio = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of audioChunks) {
                            mergedAudio.set(chunk, offset);
                            offset += chunk.length;
                        }
                        
                        // Convert back to base64 for return
                        let binary = '';
                        const len = mergedAudio.byteLength;
                        const CHUNK_SIZE = 8192;
                        for (let i = 0; i < len; i += CHUNK_SIZE) {
                            binary += String.fromCharCode.apply(null, Array.from(mergedAudio.subarray(i, Math.min(i + CHUNK_SIZE, len))));
                        }
                        resolve(btoa(binary));
                    }
                };

                ws.onerror = (e) => reject(e);
            });

            return {
                audioData,
                text: responseText
            };
        }
    }
};

/**
 * 直接调用 TTS（不经过大模型）
 * 用于特殊交互场景（如快速点击触发固定语音）
 * 使用星火超拟人 TTS，如果失败则降级到普通 TTS
 */
export async function directTextToSpeech(text: string, catConfig: CatConfig): Promise<string | null> {
    if (!apiConfig.xunfeiConfig) {
        console.warn("讯飞 TTS 未配置，无法直接语音合成");
        return null;
    }

    const { appId, apiKey, apiSecret, sparkTTSUrl, sparkTTSVcn } = apiConfig.xunfeiConfig;

    // 优先使用星火超拟人 TTS
    if (sparkTTSUrl) {
        try {
            const url = getSparkTTSUrl(sparkTTSUrl, apiKey, apiSecret);
            const vcnOverride = typeof sparkTTSVcn === 'string'
                ? sparkTTSVcn
                : (catConfig.gender === 'male' ? sparkTTSVcn?.male : sparkTTSVcn?.female);
            const vcn = vcnOverride || (catConfig.gender === 'male' ? "x5_lingfeiyi_flow" : "x5_lingxiaoxuan_flow");
            const isX5 = vcn.startsWith('x5');
            console.log(`🎙️ [直接TTS] 使用星火超拟人合成 - 发音人: ${vcn}`);

            const audioData = await new Promise<string>((resolve, reject) => {
                const ws = new WebSocket(url);
                const audioChunks: Uint8Array[] = [];

                ws.onopen = () => {
                    const params: any = {
                        header: {
                            app_id: appId,
                            status: 2
                        },
                        parameter: {
                            tts: {
                                vcn: vcn,
                                speed: 50,
                                volume: 50,
                                pitch: 50,
                                audio: {
                                    encoding: "raw",
                                    sample_rate: 24000,
                                    channels: 1,
                                    bit_depth: 16,
                                    frame_size: 0
                                }
                            }
                        },
                        payload: {
                            text: {
                                encoding: "utf8",
                                compress: "raw",
                                format: "plain",
                                status: 2,
                                seq: 0,
                                text: btoa(unescape(encodeURIComponent(text)))
                            }
                        }
                    };

                    if (!isX5) {
                        params.parameter.oral = {
                            oral_level: "mid",
                            spark_assist: 1,
                            stop_split: 0,
                            remain: 0
                        };
                    }

                    ws.send(JSON.stringify(params));
                };

                ws.onmessage = (e) => {
                    try {
                        const jsonData = JSON.parse(e.data);
                        
                        if (jsonData.header.code !== 0) {
                            console.error("星火 TTS 错误:", jsonData.header.message);
                            ws.close();
                            reject(new Error(jsonData.header.message));
                            return;
                        }

                        if (jsonData.payload && jsonData.payload.audio && jsonData.payload.audio.audio) {
                            const chunk = decodeBase64(jsonData.payload.audio.audio);
                            audioChunks.push(chunk);
                        }

                        if (jsonData.header.status === 2) {
                            ws.close();
                            const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
                            const mergedAudio = new Uint8Array(totalLength);
                            let offset = 0;
                            for (const chunk of audioChunks) {
                                mergedAudio.set(chunk, offset);
                                offset += chunk.length;
                            }
                            let binary = '';
                            const len = mergedAudio.byteLength;
                            const CHUNK_SIZE = 8192;
                            for (let i = 0; i < len; i += CHUNK_SIZE) {
                                binary += String.fromCharCode.apply(null, Array.from(mergedAudio.subarray(i, Math.min(i + CHUNK_SIZE, len))));
                            }
                            resolve(btoa(binary));
                        }
                    } catch (err) {
                        console.error("星火 TTS 处理错误:", err);
                        ws.close();
                        reject(err);
                    }
                };

                ws.onerror = (e) => reject(e);
            });

            return audioData;
        } catch (error) {
            console.warn("⚠️ [直接TTS] 星火超拟人 TTS 失败，降级到普通 TTS:", error);
            // 继续执行下方的普通 TTS
        }
    }

    // 降级：使用普通 TTS
    console.log("🎙️ [直接TTS] 使用普通 TTS");
    const url = getXunfeiTTSUrl(apiKey, apiSecret);
    const vcn = catConfig.gender === 'male' ? 'aisjiuxu' : 'xiaoyan';

    return new Promise<string | null>((resolve) => {
        const ws = new WebSocket(url);
        const audioChunks: Uint8Array[] = [];

        ws.onopen = () => {
            const params = {
                common: { app_id: appId },
                business: { aue: "raw", auf: "audio/L16;rate=16000", vcn, tte: "UTF8", speed: 50, volume: 80, pitch: 50 },
                data: { status: 2, text: btoa(unescape(encodeURIComponent(text))) }
            };
            ws.send(JSON.stringify(params));
        };

        ws.onmessage = (e) => {
            try {
                const jsonData = JSON.parse(e.data);
                if (jsonData.code !== 0) {
                    console.error("普通 TTS 错误:", jsonData.message);
                    ws.close();
                    resolve(null);
                    return;
                }
                if (jsonData.data && jsonData.data.audio) {
                    const audioBytes = Uint8Array.from(atob(jsonData.data.audio), c => c.charCodeAt(0));
                    audioChunks.push(audioBytes);
                }
                if (jsonData.code === 0 && jsonData.data.status === 2) {
                    ws.close();
                    const totalLength = audioChunks.reduce((sum, arr) => sum + arr.length, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    audioChunks.forEach(chunk => {
                        combined.set(chunk, offset);
                        offset += chunk.length;
                    });
                    resolve(btoa(String.fromCharCode(...combined)));
                }
            } catch (err) {
                console.error("普通 TTS 处理错误:", err);
                ws.close();
                resolve(null);
            }
        };

        ws.onerror = () => {
            console.error("普通 TTS WebSocket 错误");
            resolve(null);
        };

        ws.onclose = () => {
            if (audioChunks.length === 0) resolve(null);
        };
    });
}
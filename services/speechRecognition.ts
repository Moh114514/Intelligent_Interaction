/**
 * ====================================================================
 * 语音识别服务接口定义
 * ====================================================================
 * 
 * 本模块提供统一的语音识别（ASR）接口，支持多种实现方式：
 * 
 * 1. 【浏览器内置】BrowserSpeechService
 *    - 使用 Web Speech API（免费）
 *    - 无需服务器，隐私性好
 *    - 限制：需浏览器支持，准确度依赖浏览器实现
 * 
 * 2. 【OpenAI Whisper】RestApiSpeechService（示例）
 *    - 高准确度，支持多语言
 *    - 需要 API Key 和付费
 *    - 配置示例见下方
 * 
 * 3. 【Azure Speech】可扩展实现
 *    - Microsoft 认知服务
 *    - 企业级稳定性
 *    - 参考下方 AzureSpeechService 示例
 * 
 * 4. 【自建服务】可扩展实现
 *    - 使用开源模型（如 Whisper、FunASR）
 *    - 完全控制数据
 *    - 参考下方自建服务示例
 */

/**
 * 语音识别服务通用接口
 * 所有 ASR 实现都应遵循此接口
 */
export interface ISpeechService {
    /**
     * 开始录音和识别
     * @param onResult - 识别结果回调
     *                   text: 识别的文本
     *                   isFinal: 是否为最终结果（true）或临时结果（false）
     * @param onError - 错误回调
     */
    start(onResult: (text: string, isFinal: boolean) => void, onError: (error: any) => void): void;
    
    /**
     * 停止录音和识别
     */
    stop(): void;
    
    /**
     * 检查服务是否可用
     * @returns true 表示当前环境支持该服务
     */
    isAvailable(): boolean;
}

// --- Implementation 1: Browser Native Web Speech API ---
// Good for quick testing, free, built-in, but quality varies by browser/OS.
export class BrowserSpeechService implements ISpeechService {
    private recognition: any = null;
    private isListening: boolean = false;

    constructor() {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false; 
            this.recognition.interimResults = true; 
            this.recognition.lang = 'zh-CN'; // Default to Chinese for this app context
        }
    }

    isAvailable(): boolean {
        return !!this.recognition;
    }

    start(
        onResult: (text: string, isFinal: boolean) => void, 
        onError: (error: any) => void
    ): void {
        if (!this.recognition) {
            onError("Speech recognition not supported.");
            return;
        }
        if (this.isListening) return;

        this.recognition.onstart = () => { this.isListening = true; };
        
        this.recognition.onresult = (event: any) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            const text = finalTranscript || interimTranscript;
            const isFinal = !!finalTranscript;
            if (text) onResult(text, isFinal);
        };

        this.recognition.onerror = (event: any) => {
            this.isListening = false;
            onError(event.error);
        };
        this.recognition.onend = () => { this.isListening = false; };

        try {
            this.recognition.start();
        } catch (e) {
            onError(e);
        }
    }

    stop(): void {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }
}

// --- Implementation 2: Generic REST API Template (e.g., OpenAI Whisper) ---

/**
 * REST API 语音识别服务配置
 */
export interface RestApiSpeechConfig {
    /** API 端点 URL */
    apiUrl: string;
    /** API Key（可选，如果通过代理则不需要） */
    apiKey?: string;
    /** 模型名称（如 whisper-1） */
    model?: string;
    /** 语言代码（如 zh） */
    language?: string;
    /** 自定义请求头 */
    headers?: Record<string, string>;
    /** 录音格式（默认 audio/webm） */
    mimeType?: string;
}

/**
 * 通用 REST API 语音识别服务
 * 
 * 适用于：
 * - OpenAI Whisper API
 * - Groq Whisper API
 * - 自建 Whisper 服务
 * - 任何兼容 multipart/form-data 上传音频的 API
 * 
 * @example 使用 OpenAI Whisper
 * ```typescript
 * const service = new RestApiSpeechService({
 *   apiUrl: "https://api.openai.com/v1/audio/transcriptions",
 *   apiKey: "sk-...",
 *   model: "whisper-1"
 * });
 * ```
 * 
 * @example 使用自建代理（推荐）
 * ```typescript
 * const service = new RestApiSpeechService({
 *   apiUrl: "https://my-proxy.com/api/transcribe",
 *   // 无需 apiKey，由代理处理鉴权
 * });
 * ```
 */
export class RestApiSpeechService implements ISpeechService {
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private stream: MediaStream | null = null;
    private onResultCallback: ((text: string, isFinal: boolean) => void) | null = null;
    private onErrorCallback: ((error: any) => void) | null = null;
    
    private config: RestApiSpeechConfig;

    /**
     * 创建 REST API 语音服务实例
     * @param config - 服务配置
     */
    constructor(config?: RestApiSpeechConfig) {
        // 默认配置（示例）
        this.config = config || {
            apiUrl: "https://api.openai.com/v1/audio/transcriptions",
            apiKey: "", // ⚠️ 生产环境请勿硬编码
            model: "whisper-1",
            language: "zh",
            mimeType: "audio/webm"
        };
    }

    isAvailable() {
        return !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
    }

    async start(onResult: (text: string, isFinal: boolean) => void, onError: (error: any) => void) {
        this.onResultCallback = onResult;
        this.onErrorCallback = onError;
        this.audioChunks = [];

        try {
            // 1. Get Microphone Stream
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // 2. Create MediaRecorder
            // 优先使用配置的 mimeType，如果不支持则回退
            const mimeType = this.config.mimeType || 'audio/webm';
            const options = MediaRecorder.isTypeSupported(mimeType) ? { mimeType } : undefined;
            
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                // 3. Combine chunks into a single Blob (file)
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
                
                // 4. Send to API
                await this.sendAudioToApi(audioBlob);
                
                // Cleanup
                this.stream?.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start();

        } catch (err) {
            console.error("Error starting recorder:", err);
            onError(err);
        }
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    }

    private async sendAudioToApi(blob: Blob) {
        if (!this.onResultCallback) return;

        // 反馈正在处理
        // onResult("Thinking...", false); 

        try {
            const formData = new FormData();
            // 文件名后缀根据 mimeType 调整
            const ext = blob.type.includes('wav') ? 'wav' : 'webm';
            formData.append("file", blob, `recording.${ext}`);
            
            if (this.config.model) formData.append("model", this.config.model);
            if (this.config.language) formData.append("language", this.config.language);

            // 构建请求头
            const headers: Record<string, string> = { ...this.config.headers };
            if (this.config.apiKey) {
                headers["Authorization"] = `Bearer ${this.config.apiKey}`;
            }

            // 发送请求
            // 注意：fetch 会自动设置 Content-Type 为 multipart/form-data
            const response = await fetch(this.config.apiUrl, {
                method: "POST",
                headers: headers,
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Request failed: ${response.status} ${errorText}`);
            }
            
            const data = await response.json();
            // 兼容不同 API 的响应格式
            const text = data.text || data.transcription || data.result || "";

            if (!text) {
                console.warn("API returned empty text", data);
            }

            // Return final result
            this.onResultCallback(text, true);

        } catch (error) {
            console.error("Speech API Error:", error);
            if (this.onErrorCallback) this.onErrorCallback(error);
        }
    }
}

// --- Implementation 3: Xunfei Speech Service (WebSocket) ---
import CryptoJS from 'crypto-js';

// 讯飞鉴权 URL 生成函数
// 讯飞鉴权 URL 生成函数
function getWebsocketUrl(urlStr: string, apiKey: string, apiSecret: string): string {
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
 * 讯飞语音识别服务实现 (WebSocket)
 */
export class XunfeiSpeechService implements ISpeechService {
    private appId: string;
    private apiKey: string;
    private apiSecret: string;
    private url: string;
    private domain: string;
    private socket: WebSocket | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private stream: MediaStream | null = null;
    private onResultCallback: ((text: string, isFinal: boolean) => void) | null = null;
    private onErrorCallback: ((error: any) => void) | null = null;
    private status: 'init' | 'first_frame' | 'continue' | 'last_frame' = 'init';
    private resultText: string = "";

    constructor(config: { appId: string; apiKey: string; apiSecret: string; url?: string; domain?: string }) {
        this.appId = config.appId;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        // 默认为语音听写 (IAT) 接口
        this.url = config.url || 'wss://iat-api.xfyun.cn/v2/iat';
        this.domain = config.domain || 'iat';
    }

    isAvailable(): boolean {
        return !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia && !!window.WebSocket;
    }

    async start(onResult: (text: string, isFinal: boolean) => void, onError: (error: any) => void) {
        this.onResultCallback = onResult;
        this.onErrorCallback = onError;
        this.status = 'init';
        this.resultText = ""; // 重置结果文本

        try {
            // Check for browser support and secure context
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("无法访问麦克风。请确保您是通过 HTTPS 或 localhost (http://localhost:3000) 访问网页。浏览器安全策略禁止在非安全上下文中使用麦克风。");
            }

            // 1. 获取麦克风流
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // 2. 建立 WebSocket 连接
            const url = getWebsocketUrl(this.url, this.apiKey, this.apiSecret);
            this.socket = new WebSocket(url);

            this.socket.onopen = () => {
                console.log(`讯飞 WebSocket 已连接 (${this.url})`);
                this.startRecording();
            };

            this.socket.onmessage = (e) => {
                let jsonData: any;
                try {
                    jsonData = JSON.parse(e.data);
                } catch (parseError) {
                    console.error("讯飞响应解析失败:", e.data);
                    return;
                }

                if (jsonData.code !== 0) {
                    console.error(`讯飞识别错误: code=${jsonData.code}, message=${jsonData.message}`, jsonData);
                    if (this.onErrorCallback) {
                        this.onErrorCallback(jsonData.message || `未知错误: ${JSON.stringify(jsonData)}`);
                    }
                    this.stop();
                    return;
                }
                
                if (jsonData.data && jsonData.data.result) {
                    const data = jsonData.data.result;
                    let str = "";
                    const ws = data.ws;
                    for (let i = 0; i < ws.length; i++) {
                        str += ws[i].cw[0].w;
                    }
                    
                    // 累加结果
                    this.resultText += str;

                    // ls (last status): true 表示最后一帧
                    const isFinal = data.ls;
                    if (this.onResultCallback) {
                        this.onResultCallback(this.resultText, isFinal);
                    }
                    
                    if (isFinal) {
                        // 识别结束，可以自动断开或保持连接等待下一次（取决于业务逻辑，这里简单处理为断开）
                        // this.stop(); 
                    }
                }
            };

            this.socket.onerror = (e) => {
                console.error("讯飞 WebSocket 错误", e);
                if (this.onErrorCallback) this.onErrorCallback(e);
            };
            
            this.socket.onclose = () => {
                console.log("讯飞 WebSocket 已断开");
            };

        } catch (err) {
            console.error("启动讯飞服务失败:", err);
            onError(err);
        }
    }

    private startRecording() {
        if (!this.stream) return;

        // 使用 MediaRecorder 获取音频数据
        // 注意：讯飞要求 16k 16bit 单声道 PCM
        // 浏览器默认录音通常是 48k 或 44.1k float32，需要转换
        // 这里为了简化，使用 AudioContext + ScriptProcessor 进行处理（与通用 PCM 采集流程一致）
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(this.stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            // 降采样和转换逻辑 (Float32 -> Int16)
            const buffer = this.transcodeAudio(inputData);
            
            this.sendAudioData(buffer);
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // 保存引用以便清理
        (this as any).audioContext = audioContext;
        (this as any).processor = processor;
        (this as any).source = source;
    }

    private transcodeAudio(inputData: Float32Array): Int16Array {
        // 简单转换：Float32 -> Int16
        // 假设 AudioContext 已经设置了 sampleRate: 16000，这里只需位深转换
        const l = inputData.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    }

    private sendAudioData(data: Int16Array) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

        // Base64 编码
        const buffer = new Uint8Array(data.buffer);
        let binary = '';
        const len = buffer.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(buffer[i]);
        }
        const base64Data = btoa(binary);

        let frameData: any = {
            common: {
                app_id: this.appId
            },
            business: {
                language: "zh_cn",
                domain: this.domain,
                accent: "mandarin",
                vad_eos: 10000, // 延长静音检测时间到 10秒，提高识别完整性
                // dwa: "wpgs" // 关闭动态修正，简化结果处理（直接累加）
            },
            data: {
                status: 1,
                format: "audio/L16;rate=16000",
                encoding: "raw",
                audio: base64Data
            }
        };

        // 状态机处理
        if (this.status === 'init') {
            frameData.data.status = 0; // 第一帧
            this.status = 'first_frame';
        } else if (this.status === 'first_frame') {
            frameData.data.status = 1; // 中间帧
            this.status = 'continue';
        } else {
            frameData.data.status = 1; // 中间帧
        }

        // 发送
        this.socket.send(JSON.stringify(frameData));
    }

    stop() {
        // 发送结束帧
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log("发送结束帧，等待最终结果...");
            this.socket.send(JSON.stringify({
                data: {
                    status: 2, // 最后一帧
                    format: "audio/L16;rate=16000",
                    encoding: "raw",
                    audio: ""
                }
            }));
            // 不要立即关闭连接，等待服务端返回最终结果
            // 设置超时强制关闭
            setTimeout(() => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    console.log("等待最终结果超时，关闭连接");
                    this.socket.close();
                }
            }, 5000);
        } else {
            this.socket = null;
        }
        
        this.status = 'init';

        // 停止录音流
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        
        // 清理 AudioContext
        const ctx = (this as any).audioContext;
        if (ctx && ctx.state !== 'closed') ctx.close();
    }
}

/**
 * ====================================================================
 * 更多第三方服务接入示例
 * ====================================================================
 * 
 * 1. Azure Speech Service (通过 REST API)
 *    - URL: https://<region>.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
 *    - Headers: Ocp-Apim-Subscription-Key: <key>, Content-Type: audio/wav
 * 
 * 2. Google Cloud Speech-to-Text
 *    - 建议通过后端代理调用，因为需要复杂的鉴权
 * 
 * 3. 自建 FunASR / Whisper 服务
 *    - 通常提供类似 OpenAI 的接口或简单的文件上传接口
 *    - 只需修改 apiUrl 即可接入
 */

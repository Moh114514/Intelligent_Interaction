
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CatAvatar } from './features/avatar';
import { DiagnosticsPanel } from './features/diagnostics';
import { ConversationPanel, appendMessage, appendTranscript, createMessageHistory, MessageHistory } from './features/conversation';
import { ISpeechService, BrowserSpeechService, decodeAudioData, decodeBase64, useAudioPlayback } from './features/speech';
import { BLACK_CAT_CONFIG, WHITE_CAT_CONFIG } from './constants';
import { CatConfig, CatType } from './types';
import { LiveSessionManager, sendTextMessage, directTextToSpeech } from './services/geminiService';
import { createCustomSpeechService } from './config';
import { 
    UserIcon, 
    SparklesIcon,
    SpeakerWaveIcon,
    SpeakerXMarkIcon,
    MusicalNoteIcon
} from '@heroicons/react/24/solid';

function App() {
    // API Key State
    const [hasApiKey, setHasApiKey] = useState(false);

    // App State
    const [currentCat, setCurrentCat] = useState<CatConfig>(BLACK_CAT_CONFIG);
    const [messages, setMessages] = useState<MessageHistory>(createMessageHistory);
    const [inputText, setInputText] = useState('');
    
    // States for UI
    const [isListening, setIsListening] = useState(false); // Microphone active
    const [isProcessingVoice, setIsProcessingVoice] = useState(false); // "Thinking" after voice
    const [isSpeaking, setIsSpeaking] = useState(false); // Cat speaking
    const [isLoadingText, setIsLoadingText] = useState(false); // Text input loading
    const [volume, setVolume] = useState(0.7); // Volume control (0-1)
    const [isSinging, setIsSinging] = useState(false); // Cat singing state
    const [showVolumeSlider, setShowVolumeSlider] = useState(false); // Show volume slider
    const [showFishAnimation, setShowFishAnimation] = useState(false); // Fish falling animation
    const [showAngryCat, setShowAngryCat] = useState(false); // Show angry cat image
    const [hasGreeted, setHasGreeted] = useState<{ [key: string]: boolean }>({ 
        [CatType.BLACK]: false, 
        [CatType.WHITE]: false 
    }); // Track if each cat has greeted
    const [isStarted, setIsStarted] = useState(false); // Track if user has started conversation
    
    // New State: Toggle between Gemini Live (Native) and External ASR (Interface)
    // Initialize based on config availability
        const [useExternalASR, setUseExternalASR] = useState(true); // 默认使用讯飞

    // Audio Refs
    const liveSessionRef = useRef<LiveSessionManager | null>(null);
    const greetingInProgressRef = useRef<Set<string>>(new Set()); // 追踪正在进行的开场白
    
    // External Speech Service Ref
    // 使用 config.ts 中定义的自定义语音服务，如果未定义则回退到浏览器原生识别
    const speechServiceRef = useRef<ISpeechService>(createCustomSpeechService() || new BrowserSpeechService());

    // Check for API Key on Mount
    useEffect(() => {
        const checkKey = async () => {
            const win = window as any;
            if (win.aistudio && win.aistudio.hasSelectedApiKey) {
                const hasKey = await win.aistudio.hasSelectedApiKey();
                setHasApiKey(hasKey);
            } else {
                // 检查环境变量或是否已配置自定义 API
                // 如果使用了自定义代理或 API，也认为有 Key
                if (process.env.API_KEY) setHasApiKey(true);
            }
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        const win = window as any;
        if (win.aistudio && win.aistudio.openSelectKey) {
            await win.aistudio.openSelectKey();
            setHasApiKey(true);
        }
    };

    const addMessage = useCallback((role: 'user' | 'model', text: string) => {
        setMessages(previous => appendMessage(previous, currentCat.type, role, text));
    }, [currentCat.type]);

    const handlePlaybackStart = useCallback(() => {
        setIsProcessingVoice(false);
        setIsSpeaking(true);
    }, []);

    const handlePlaybackIdle = useCallback(() => {
        setIsSpeaking(false);
        setIsSinging(false);
    }, []);

    const { audioContextRef, playAudioBuffer, resetPlayback, resetQueue } = useAudioPlayback({
        volume,
        onPlaybackStart: handlePlaybackStart,
        onPlaybackIdle: handlePlaybackIdle
    });

    // Initialize Live Session on Mount (or when cat changes)
    useEffect(() => {
        // 移除 hasApiKey 检查，使用自定义配置
        // if (!hasApiKey) return;

        // Cleanup previous session
        if (liveSessionRef.current) {
            liveSessionRef.current.disconnect();
        }

        // Create new session manager
        const manager = new LiveSessionManager(currentCat, {
            onAudioData: (buffer) => {
                playAudioBuffer(buffer);
            },
            onTextTranscript: (text, role) => {
               // If we receive a model transcript, we are definitely done thinking
               if (role === 'model') setIsProcessingVoice(false);

               if (text.length > 0) {
                    setMessages(previous => appendTranscript(previous, currentCat.type, role, text));
               }
            },
            onTurnComplete: () => {
                // Model finished its turn. If we were processing, stop.
                setIsProcessingVoice(false);
            },
            onClose: () => {
                console.log("Session closed");
                if (!useExternalASR) {
                    setIsListening(false);
                    setIsProcessingVoice(false);
                }
            }
        });

        liveSessionRef.current = manager;

        return () => {
            manager.disconnect();
        }
    }, [currentCat, playAudioBuffer, useExternalASR]);

    // 首次进入时的开场白
    const sayGreeting = useCallback(async () => {
        const catType = currentCat.type;
        
        // 检查是否已打招呼或正在进行中
        if (hasGreeted[catType] || !audioContextRef.current || greetingInProgressRef.current.has(catType)) {
            console.log('👋 [开场白] 跳过 - 已打招呼:', hasGreeted[catType], '正在进行:', greetingInProgressRef.current.has(catType));
            return;
        }
        
        console.log('👋 [开场白] 开始生成...', currentCat.name);
        greetingInProgressRef.current.add(catType); // 标记为进行中
        setHasGreeted(prev => ({ ...prev, [catType]: true }));
        setIsProcessingVoice(true);
        setIsLoadingText(true);
        
        const greetingPrompt = "这是你第一次见到主人，请用符合你性格的方式打个招呼并简单介绍一下自己。保持简短，1-2句话即可。";
        
        try {
            // 开场白不需要历史上下文
            const { audioData, text: responseText } = await sendTextMessage(greetingPrompt, currentCat, []);
            console.log('👋 [开场白] 收到响应:', responseText);
            
            // 显示猫咪的开场白
            addMessage('model', responseText);
            
            if (audioData && audioContextRef.current) {
                const cleanBase64 = audioData.replace(/^data:audio\/\w+;base64,/, "");
                const bytes = decodeBase64(cleanBase64);
                const audioBuffer = await decodeAudioData(bytes, audioContextRef.current);
                console.log('👋 [开场白] 开始播放音频, 时长:', audioBuffer.duration, '秒');
                playAudioBuffer(audioBuffer);
            }
        } catch (error) {
            console.error('❌ [开场白] 错误:', error);
        } finally {
            greetingInProgressRef.current.delete(catType); // 移除进行中标记
            setIsProcessingVoice(false);
            setIsLoadingText(false);
        }
    }, [hasGreeted, currentCat, audioContextRef, addMessage, playAudioBuffer]);

    // 处理开始对话按钮点击
    const handleStart = async () => {
        console.log('🚀 [开始对话] 按钮点击');

        // Enter the conversation immediately; audio initialization is optional.
        setIsStarted(true);
        
        // 激活 AudioContext
        if (audioContextRef.current?.state === 'suspended') {
            try {
                await audioContextRef.current.resume();
                console.log('🚀 [AudioContext] 已激活');
            } catch (e) {
                console.error('🚀 [AudioContext] 激活失败:', e);
            }
        }
        
        // 不在这里直接调用 sayGreeting，让 useEffect 处理
    };

    // 当音频上下文准备好且已开始对话且当前猫咪尚未打招呼时，自动执行开场白
    useEffect(() => {
        const currentCatType = currentCat.type;
        if (isStarted && audioContextRef.current && !hasGreeted[currentCatType] && !isSpeaking) {
            // 延迟500ms执行，只检查一次
            const timer = setTimeout(() => {
                // 再次检查状态，避免在延迟期间状态改变
                if (!hasGreeted[currentCatType]) {
                    console.log('👋 [开场白触发]', currentCat.name);
                    sayGreeting();
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isStarted, currentCat.type, isSpeaking]);

    // Handlers
    const handleToggleCat = () => {
        setCurrentCat(prev => prev.type === CatType.BLACK ? WHITE_CAT_CONFIG : BLACK_CAT_CONFIG);
        resetQueue();
        setIsSpeaking(false);
        setIsListening(false);
        setIsProcessingVoice(false);
    };

    // Handle singing
    const handleSing = async () => {
        if (isSinging || isSpeaking || isLoadingText) return;
        
        console.log('🎵 [唱歌] 按钮点击');
        setIsSinging(true);
        setIsLoadingText(true);
        setIsProcessingVoice(true);
        
        const songPrompts = [
            "请你作为一只可爱的猫咪唱一首关于晒太阳的歌",
            "请你作为一只快乐的猫咪唱一首关于抓老鼠的歌",
            "请你作为一只慵懒的猫咪唱一首关于睡午觉的歌"
        ];
        
        const randomPrompt = songPrompts[Math.floor(Math.random() * songPrompts.length)];
        console.log('🎵 [唱歌] 发送提示词:', randomPrompt);
        
        // 添加用户消息（隐藏显示，只是为了上下文）
        // addMessage('user', randomPrompt);
        
        try {
            const { audioData, text: responseText } = await sendTextMessage(randomPrompt, currentCat, messages[currentCat.type]);
            console.log('🎵 [唱歌] 收到响应:', responseText);
            console.log('🎵 [唱歌] 音频数据长度:', audioData?.length || 0);
            
            // 显示猫咪的回复
            addMessage('model', responseText);
            
            if (audioData && audioContextRef.current) {
                const cleanBase64 = audioData.replace(/^data:audio\/\w+;base64,/, "");
                const bytes = decodeBase64(cleanBase64);
                const audioBuffer = await decodeAudioData(
                    bytes,
                    audioContextRef.current
                );
                console.log('🎵 [唱歌] 开始播放音频, 时长:', audioBuffer.duration, '秒');
                playAudioBuffer(audioBuffer);
            }
        } catch (error) {
            console.error('❌ [唱歌] 错误:', error);
            addMessage('model', "喵呜~ 我现在唱不出来...");
            setIsSinging(false);
        } finally {
            setIsProcessingVoice(false);
            setIsLoadingText(false);
        }
    };

    // Handle feeding
    const handleFeed = async () => {
        if (isSpeaking || isLoadingText) return;
        
        console.log('🐟 [投喂] 按钮点击');
        
        // 触发小鱼干掉落动画
        setShowFishAnimation(true);
        setTimeout(() => setShowFishAnimation(false), 2000);
        
        setIsProcessingVoice(true);
        setIsLoadingText(true);
        
        const feedPrompt = "主人给你投喂了美味的小鱼干，请表达你的感谢之情";
        console.log('🐟 [投喂] 发送提示词:', feedPrompt);
        
        // 添加用户消息（隐藏显示）
        // addMessage('user', feedPrompt);
        
        try {
            const { audioData, text: responseText } = await sendTextMessage(feedPrompt, currentCat, messages[currentCat.type]);
            console.log('🐟 [投喂] 收到响应:', responseText);
            console.log('🐟 [投喂] 音频数据长度:', audioData?.length || 0);
            
            // 显示猫咪的回复
            addMessage('model', responseText);
            
            if (audioData && audioContextRef.current) {
                const cleanBase64 = audioData.replace(/^data:audio\/\w+;base64,/, "");
                const bytes = decodeBase64(cleanBase64);
                const audioBuffer = await decodeAudioData(
                    bytes,
                    audioContextRef.current
                );
                console.log('🐟 [投喂] 开始播放音频, 时长:', audioBuffer.duration, '秒');
                playAudioBuffer(audioBuffer);
            }
        } catch (error) {
            console.error('❌ [投喂] 错误:', error);
            addMessage('model', "喵~ 谢谢你的小鱼干！");
        } finally {
            setIsProcessingVoice(false);
            setIsLoadingText(false);
        }
    };

    // 处理连续点击猫咪（5次）
    const handleMultipleClicks = async () => {
        console.log('🐱 [连续点击] 触发特殊反应');
        
        // 显示愤怒猫咪图片
        setShowAngryCat(true);
        
        // 停止当前所有播放并重置状态
        setIsSpeaking(false);
        setIsSinging(false);
        await resetPlayback();
        
        // 直接调用 TTS，不经过大模型
        try {
            console.log('🐱 [连续点击] 开始调用 TTS...');
            const audioData = await directTextToSpeech("干嘛————", currentCat);
            console.log('🐱 [连续点击] TTS 返回，数据长度:', audioData?.length);
            
            if (audioData && audioContextRef.current) {
                // 解码并播放音频（星火超拟人 TTS 使用 24kHz）
                const audioBytes = decodeBase64(audioData);
                console.log('🐱 [连续点击] 解码完成，字节长度:', audioBytes.length);
                const buffer = await decodeAudioData(audioBytes, audioContextRef.current, 24000);
                console.log('🐱 [连续点击] 音频缓冲创建完成，时长:', buffer.duration, '秒');
                playAudioBuffer(buffer);
            }
        } catch (error) {
            console.error('🐱 [连续点击] TTS 错误:', error);
        }
        
        // 2秒后恢复正常
        setTimeout(() => {
            setShowAngryCat(false);
        }, 2000);
    };

    const handleTextSubmit = async (textToSubmit?: string) => {
        const text = textToSubmit || inputText;
        if (!text.trim()) return;

        setInputText('');
        // If triggered by external ASR, message is already added via setInputText feedback or direct add
        // Ensure we don't duplicate if it came from the input box
        if (!textToSubmit) {
            addMessage('user', text);
        }
        
        setIsLoadingText(true);
        setIsProcessingVoice(true); // Reuse this for avatar state

        try {
            // Using turn-based for text input (or external ASR result)
            const { audioData, text: responseText } = await sendTextMessage(text, currentCat, messages[currentCat.type]);
            
            addMessage('model', responseText);

            if (audioData && audioContextRef.current) {
                 // decodeBase64 now handles cleaning internally, but we keep this for safety
                 const cleanBase64 = audioData.replace(/^data:audio\/\w+;base64,/, "");
                 const bytes = decodeBase64(cleanBase64);
                 const audioBuffer = await decodeAudioData(
                     bytes, 
                     audioContextRef.current
                 );
                 playAudioBuffer(audioBuffer);
            }
        } catch (err) {
            console.error(err);
            addMessage('model', "Meow? Something went wrong.");
            setIsProcessingVoice(false);
        } finally {
            setIsLoadingText(false);
        }
    };

    const startListening = async () => {
        setIsListening(true);

        // Branch 1: Use External Service (Interface)
        if (useExternalASR) {
            speechServiceRef.current.start(
                (text, isFinal) => {
                    setInputText(text); // Live feedback in input box
                    if (isFinal) {
                        // Once final, stop listening
                        stopListening();
                        // Filter out noise/punctuation-only results
                        if (text.trim().length > 1 || /^[\u4e00-\u9fa5a-zA-Z0-9]/.test(text.trim())) {
                            // Just populate the input, do NOT auto-submit
                            // addMessage('user', text);
                            // handleTextSubmit(text);
                        } else {
                            console.log("Ignored empty/punctuation result:", text);
                            setInputText(''); // Clear invalid input
                        }
                    }
                },
                (error) => {
                    console.error("External ASR Error:", error);
                    stopListening();
                }
            );
            return;
        }

        // Branch 2: Use Gemini Live (Default)
        if (!liveSessionRef.current) return;
        try {
            // Ensure audio context is resumed
            if (audioContextRef.current?.state === 'suspended') {
                await audioContextRef.current.resume();
            }
            await liveSessionRef.current.startRecording();
        } catch (error) {
            console.error("Failed to start recording:", error);
            setIsListening(false);
        }
    };

    const stopListening = () => {
        setIsListening(false);

        // Branch 1: Stop External
        if (useExternalASR) {
            speechServiceRef.current.stop();
            // Note: logic to submit is handled in onResult 'isFinal'
            return;
        }
        
        // Branch 2: Stop Gemini Live
        if (!liveSessionRef.current) return;
        const hasRecordedData = liveSessionRef.current.stopRecording();
        
        if (hasRecordedData) {
            setIsProcessingVoice(true); // Start "Thinking" state
        } else {
            console.warn("No audio recorded, skipping request");
            setIsProcessingVoice(false);
        }
    };

    const handleInterrupt = async () => {
        console.log("Interrupting...");
        // Reset all states
        setIsSpeaking(false);
        setIsProcessingVoice(false);
        setIsLoadingText(false);
        setIsListening(false);


        // Stop External
        if (useExternalASR) {
            speechServiceRef.current.stop();
        }

        // Reset connection to clear any pending buffer/state
        if (liveSessionRef.current) {
            await liveSessionRef.current.disconnect();
            // Reconnect for next interaction
            await liveSessionRef.current.connect();
        }

        // Stop queued and active audio before accepting the next interaction.
        await resetPlayback();
    };

    // Determine global loading/thinking state for Avatar
    const isThinking = isLoadingText || isProcessingVoice;
    // Determine if we should show the interrupt button
    const showInterrupt = isThinking || isSpeaking;

    // --- Render API Key Selection if needed ---
    /*if (!hasApiKey) {
        return (
             <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 p-4">
                 <div className="bg-white p-8 rounded-3xl shadow-xl border-4 border-orange-100 text-center max-w-md w-full">
                    <h1 className="text-3xl font-bold text-orange-600 mb-6 flex items-center justify-center gap-2">
                        <span>🐾</span> Garfield Chat
                    </h1>
                    <p className="text-gray-600 mb-8 text-lg">To start chatting, please select your Google API Key.</p>
                    <button 
                        onClick={handleSelectKey}
                        className="bg-orange-500 text-white px-8 py-4 rounded-full font-bold text-xl shadow-lg hover:bg-orange-600 transition-transform hover:scale-105 active:scale-95"
                    >
                        Select API Key
                    </button>
                    <p className="mt-6 text-xs text-gray-400">
                        Keys are stored securely in the environment. <br/>
                        <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline hover:text-orange-500">Billing Information</a>
                    </p>
                 </div>
            </div>
        );
    }
    */
    return (
        <div className="min-h-screen flex flex-col items-center bg-amber-50 overflow-hidden fixed inset-0">
            
            {/* Start Dialog Overlay */}
            {!isStarted && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="bg-white p-8 rounded-3xl shadow-2xl border-4 border-orange-200 text-center max-w-md animate-fade-in">
                        <div className="text-6xl mb-6 animate-bounce">🐱</div>
                        <h2 className="text-3xl font-bold text-orange-600 mb-4">
                            欢迎来到 Garfield Chat
                        </h2>
                        <p className="text-gray-600 mb-6 text-lg">
                            点击下方按钮开始与可爱的猫咪对话吧！
                        </p>
                        <button
                            onClick={handleStart}
                            className="bg-gradient-to-r from-orange-400 to-orange-600 text-white px-10 py-4 rounded-full font-bold text-xl shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200"
                        >
                            开始对话 🎤
                        </button>
                    </div>
                </div>
            )}
            
            {/* Header / Toggle */}
            <div className="w-full max-w-md px-6 py-4 flex justify-between items-center z-20 flex-none">
                <h1 className="text-2xl font-bold text-orange-600 tracking-wider drop-shadow-sm flex items-center gap-2">
                    <span>🐾</span>
                    GARFIELD CHAT
                </h1>
                <div className="flex gap-2">
                    {/* API Switcher Button Removed */}

                    <button 
                        onClick={handleToggleCat}
                        disabled={showInterrupt}
                        className={`flex items-center space-x-2 bg-white px-3 py-1.5 rounded-full shadow-md border-2 border-orange-200 transition-colors active:scale-95
                            ${showInterrupt ? 'opacity-50 cursor-not-allowed' : 'hover:bg-orange-50'}
                        `}
                    >
                        {currentCat.type === CatType.BLACK ? (
                            <>
                                <div className="p-1 bg-slate-800 rounded-full"><UserIcon className="w-3 h-3 text-white" /></div>
                                <span className="font-bold text-slate-700 text-sm">Kuro</span>
                            </>
                        ) : (
                            <>
                                <div className="p-1 bg-pink-400 rounded-full"><SparklesIcon className="w-3 h-3 text-white" /></div>
                                <span className="font-bold text-pink-500 text-sm">Shiro</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            <DiagnosticsPanel />

            {/* Main Content Area - Flex Column */}
            <div className="flex-1 w-full max-w-md flex flex-col relative z-10">
                
                {/* Avatar Area */}
                <div className="flex-1 flex items-center justify-center min-h-[250px]">
                    <CatAvatar 
                        config={currentCat} 
                        isSpeaking={isSpeaking} 
                        isListening={isListening}
                        isThinking={isThinking}
                        onCatClick={() => {
                            // Wake up or interact with cat
                            console.log('Cat clicked!');
                        }}
                        onMultipleClicks={handleMultipleClicks}
                        showAngryCat={showAngryCat}
                    />
                </div>

                <ConversationPanel
                    messages={messages[currentCat.type]}
                    inputText={inputText}
                    isListening={isListening}
                    isProcessingVoice={isProcessingVoice}
                    isThinking={isThinking}
                    showInterrupt={showInterrupt}
                    useExternalASR={useExternalASR}
                    onInputChange={setInputText}
                    onStartListening={startListening}
                    onStopListening={stopListening}
                    onSubmit={() => handleTextSubmit()}
                    onInterrupt={handleInterrupt}
                />
            </div>

            {/* Floating Action Buttons - Bottom Right */}
            <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
                {/* Volume Control */}
                <div className="relative">
                    {showVolumeSlider && (
                        <div className="absolute bottom-full right-0 mb-2 bg-white rounded-lg shadow-xl p-3 border-2 border-orange-200">
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={volume * 100}
                                onChange={(e) => {
                                    const newVolume = parseInt(e.target.value) / 100;
                                    console.log('🎚️ [音量滑块] 调节音量:', newVolume, '(', Math.round(newVolume * 100), '%)');
                                    setVolume(newVolume);
                                }}
                                disabled={isSpeaking}
                                className={`w-32 h-2 bg-orange-200 rounded-lg appearance-none ${isSpeaking ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                style={{
                                    background: `linear-gradient(to right, #fb923c 0%, #fb923c ${volume * 100}%, #fed7aa ${volume * 100}%, #fed7aa 100%)`
                                }}
                            />
                            <div className="text-xs text-center mt-1 text-orange-600 font-semibold">{Math.round(volume * 100)}%</div>
                        </div>
                    )}
                    <button
                        onClick={() => !isSpeaking && setShowVolumeSlider(!showVolumeSlider)}
                        disabled={isSpeaking}
                        className={`w-12 h-12 bg-white rounded-full shadow-lg border-2 border-orange-200 flex items-center justify-center transition-transform ${
                            isSpeaking ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110 active:scale-95'
                        }`}
                        title={isSpeaking ? "说话时无法调节音量" : "音量控制"}
                    >
                        {volume > 0.5 ? (
                            <SpeakerWaveIcon className="w-6 h-6 text-orange-500" />
                        ) : volume > 0 ? (
                            <SpeakerWaveIcon className="w-6 h-6 text-orange-300" />
                        ) : (
                            <SpeakerXMarkIcon className="w-6 h-6 text-gray-400" />
                        )}
                    </button>
                </div>

                {/* Sing Button */}
                <button
                    onClick={handleSing}
                    disabled={isSinging || isSpeaking}
                    className={`w-12 h-12 bg-white rounded-full shadow-lg border-2 flex items-center justify-center transition-transform ${
                        isSinging ? 'border-pink-400 animate-pulse' : 'border-pink-200 hover:scale-110 active:scale-95'
                    } ${(isSinging || isSpeaking) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title="让猫咪唱歌"
                >
                    <MusicalNoteIcon className={`w-6 h-6 ${isSinging ? 'text-pink-500' : 'text-pink-400'}`} />
                </button>

                {/* Feed Button */}
                <button
                    onClick={handleFeed}
                    disabled={isSpeaking}
                    className={`w-12 h-12 bg-white rounded-full shadow-lg border-2 border-blue-200 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform ${
                        isSpeaking ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    title="投喂小鱼干"
                >
                    <span className="text-2xl">🐟</span>
                </button>
            </div>

            {/* Fish Falling Animation */}
            {showFishAnimation && (
                <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
                    {[...Array(8)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute animate-fish-fall"
                            style={{
                                left: `${10 + i * 12}%`,
                                animationDelay: `${i * 0.15}s`,
                                fontSize: '2rem'
                            }}
                        >
                            🐟
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default App;

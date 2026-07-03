import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UserIcon, SparklesIcon, SpeakerWaveIcon, SpeakerXMarkIcon, MusicalNoteIcon } from '@heroicons/react/24/solid';
import { v4 as uuidv4 } from 'uuid';

import { CatAvatar } from './features/avatar';
import { DiagnosticsPanel } from './features/diagnostics';
import { ConversationPanel, appendMessage, createMessageHistory, MessageHistory, removeMessage, upsertModelMessage } from './features/conversation';
import { decodeAudioData, decodeBase64, useAudioPlayback } from './features/speech';
import { BLACK_CAT_CONFIG, WHITE_CAT_CONFIG } from './constants';
import { CatConfig, CatType } from './types';
import { AgentClient, AgentClientError } from './services/agentClient';
import { createCustomSpeechService } from './config';
import { synthesizeSpeech } from './services/xunfeiTts';

function App() {
  const [currentCat, setCurrentCat] = useState<CatConfig>(BLACK_CAT_CONFIG);
  const [messages, setMessages] = useState<MessageHistory>(createMessageHistory);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isSinging, setIsSinging] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showFishAnimation, setShowFishAnimation] = useState(false);
  const [showAngryCat, setShowAngryCat] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [hasGreeted, setHasGreeted] = useState<Record<CatType, boolean>>({
    [CatType.BLACK]: false,
    [CatType.WHITE]: false
  });

  const agentClientRef = useRef(new AgentClient());
  const activeRequestRef = useRef<{ requestId: string; sessionId: string } | null>(null);
  const sessionIdsRef = useRef<Record<CatType, string>>({
    [CatType.BLACK]: uuidv4(),
    [CatType.WHITE]: uuidv4()
  });
  const speechServiceRef = useRef(createCustomSpeechService());
  const greetingInProgressRef = useRef(new Set<CatType>());

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

  useEffect(() => () => agentClientRef.current.disconnect(), []);

  const speak = useCallback(async (text: string, cat: CatConfig) => {
    try {
      const result = await synthesizeSpeech(text, cat);
      if (!result || !audioContextRef.current) return;
      const buffer = await decodeAudioData(
        decodeBase64(result.audioData),
        audioContextRef.current,
        result.sampleRate
      );
      playAudioBuffer(buffer);
    } catch (error) {
      console.warn('Speech synthesis failed; keeping the text response.', error);
    }
  }, [audioContextRef, playAudioBuffer]);

  const generate = useCallback(async (prompt: string, cat: CatConfig, speakResult = true) => {
    const sessionId = sessionIdsRef.current[cat.type];
    let streamed = '';
    const request = agentClientRef.current.sendMessage(sessionId, cat.type, prompt, (delta) => {
      streamed += delta;
      setMessages((previous) => upsertModelMessage(previous, cat.type, request.requestId, streamed));
    });
    activeRequestRef.current = { requestId: request.requestId, sessionId };
    try {
      const response = await request.completion;
      setMessages((previous) => upsertModelMessage(previous, cat.type, request.requestId, response));
      if (speakResult) await speak(response, cat);
      return response;
    } catch (error) {
      setMessages((previous) => removeMessage(previous, cat.type, request.requestId));
      if (!(error instanceof AgentClientError) || error.errorCode !== 'REQUEST_CANCELLED') {
        const message = error instanceof Error ? error.message : 'The agent request failed';
        setMessages((previous) => appendMessage(previous, cat.type, 'model', `Meow? ${message}`));
      }
      throw error;
    } finally {
      if (activeRequestRef.current?.requestId === request.requestId) activeRequestRef.current = null;
    }
  }, [speak]);

  const handleStart = async () => {
    setIsStarted(true);
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume().catch(() => undefined);
    }
  };

  useEffect(() => {
    const catType = currentCat.type;
    if (!isStarted || hasGreeted[catType] || greetingInProgressRef.current.has(catType)) return;
    const timer = window.setTimeout(() => {
      greetingInProgressRef.current.add(catType);
      setHasGreeted((previous) => ({ ...previous, [catType]: true }));
      setIsLoadingText(true);
      setIsProcessingVoice(true);
      void generate('这是你第一次见到主人，请用符合你性格的方式简短打招呼并介绍自己。', currentCat)
        .catch(() => undefined)
        .finally(() => {
          greetingInProgressRef.current.delete(catType);
          setIsLoadingText(false);
          setIsProcessingVoice(false);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentCat, generate, hasGreeted, isStarted]);

  const handleToggleCat = () => {
    setCurrentCat((previous) => previous.type === CatType.BLACK ? WHITE_CAT_CONFIG : BLACK_CAT_CONFIG);
    resetQueue();
    setIsSpeaking(false);
    setIsListening(false);
    setIsProcessingVoice(false);
  };

  const handleTextSubmit = async () => {
    const text = inputText.trim();
    if (!text || isLoadingText) return;
    const cat = currentCat;
    setInputText('');
    setMessages((previous) => appendMessage(previous, cat.type, 'user', text));
    setIsLoadingText(true);
    setIsProcessingVoice(true);
    try {
      await generate(text, cat);
    } catch {
      // The generated error message is already displayed.
    } finally {
      setIsLoadingText(false);
      setIsProcessingVoice(false);
    }
  };

  const handleSing = async () => {
    if (isSinging || isSpeaking || isLoadingText) return;
    const cat = currentCat;
    setIsSinging(true);
    setIsLoadingText(true);
    setIsProcessingVoice(true);
    try {
      await generate('请唱一小段原创、轻松可爱的短歌，不要引用现有歌曲歌词。', cat);
    } catch {
      setIsSinging(false);
    } finally {
      setIsLoadingText(false);
      setIsProcessingVoice(false);
    }
  };

  const handleFeed = async () => {
    if (isSpeaking || isLoadingText) return;
    const cat = currentCat;
    setShowFishAnimation(true);
    window.setTimeout(() => setShowFishAnimation(false), 2000);
    setIsLoadingText(true);
    setIsProcessingVoice(true);
    try {
      await generate('主人给你投喂了美味的小鱼干，请简短表达感谢。', cat);
    } catch {
      // The generated error message is already displayed.
    } finally {
      setIsLoadingText(false);
      setIsProcessingVoice(false);
    }
  };

  const handleMultipleClicks = async () => {
    setShowAngryCat(true);
    await resetPlayback();
    const result = await synthesizeSpeech('干嘛——', currentCat).catch(() => null);
    if (result && audioContextRef.current) {
      const buffer = await decodeAudioData(decodeBase64(result.audioData), audioContextRef.current, result.sampleRate);
      playAudioBuffer(buffer);
    }
    window.setTimeout(() => setShowAngryCat(false), 2000);
  };

  const stopListening = useCallback(() => {
    setIsListening(false);
    speechServiceRef.current.stop();
  }, []);

  const startListening = () => {
    setIsListening(true);
    speechServiceRef.current.start(
      (text, isFinal) => {
        setInputText(text);
        if (isFinal) stopListening();
      },
      (error) => {
        console.error('Speech recognition failed:', error);
        stopListening();
      }
    );
  };

  const handleInterrupt = async () => {
    const active = activeRequestRef.current;
    if (active) agentClientRef.current.cancel(active.sessionId, active.requestId);
    speechServiceRef.current.stop();
    setIsListening(false);
    setIsProcessingVoice(false);
    setIsLoadingText(false);
    setIsSpeaking(false);
    await resetPlayback();
  };

  const isThinking = isLoadingText || isProcessingVoice;
  const showInterrupt = isThinking || isSpeaking;

  return (
    <div className="min-h-screen flex flex-col items-center bg-amber-50 overflow-hidden fixed inset-0">
      {!isStarted && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl border-4 border-orange-200 text-center max-w-md">
            <div className="text-6xl mb-6 animate-bounce">🐈</div>
            <h2 className="text-3xl font-bold text-orange-600 mb-4">欢迎来到 Garfield Chat</h2>
            <p className="text-gray-600 mb-6 text-lg">点击下方按钮开始与猫咪对话。</p>
            <button onClick={handleStart} className="bg-gradient-to-r from-orange-400 to-orange-600 text-white px-10 py-4 rounded-full font-bold text-xl shadow-lg hover:scale-105 active:scale-95 transition-all">
              开始对话
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-md px-6 py-4 flex justify-between items-center z-20 flex-none">
        <h1 className="text-2xl font-bold text-orange-600 tracking-wider flex items-center gap-2"><span>🐾</span>GARFIELD CHAT</h1>
        <button
          onClick={handleToggleCat}
          disabled={showInterrupt}
          className={`flex items-center space-x-2 bg-white px-3 py-1.5 rounded-full shadow-md border-2 border-orange-200 ${showInterrupt ? 'opacity-50 cursor-not-allowed' : 'hover:bg-orange-50'}`}
        >
          {currentCat.type === CatType.BLACK ? (
            <><div className="p-1 bg-slate-800 rounded-full"><UserIcon className="w-3 h-3 text-white" /></div><span className="font-bold text-slate-700 text-sm">Kuro</span></>
          ) : (
            <><div className="p-1 bg-pink-400 rounded-full"><SparklesIcon className="w-3 h-3 text-white" /></div><span className="font-bold text-pink-500 text-sm">Shiro</span></>
          )}
        </button>
      </div>

      <DiagnosticsPanel />

      <div className="flex-1 w-full max-w-md flex flex-col relative z-10">
        <div className="flex-1 flex items-center justify-center min-h-[250px]">
          <CatAvatar
            config={currentCat}
            isSpeaking={isSpeaking}
            isListening={isListening}
            isThinking={isThinking}
            onCatClick={() => undefined}
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
          onInputChange={setInputText}
          onStartListening={startListening}
          onStopListening={stopListening}
          onSubmit={handleTextSubmit}
          onInterrupt={handleInterrupt}
        />
      </div>

      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
        <div className="relative">
          {showVolumeSlider && (
            <div className="absolute bottom-full right-0 mb-2 bg-white rounded-lg shadow-xl p-3 border-2 border-orange-200">
              <input type="range" min="0" max="100" value={volume * 100} onChange={(event) => setVolume(Number(event.target.value) / 100)} disabled={isSpeaking} className="w-32" />
              <div className="text-xs text-center mt-1 text-orange-600 font-semibold">{Math.round(volume * 100)}%</div>
            </div>
          )}
          <button onClick={() => !isSpeaking && setShowVolumeSlider(!showVolumeSlider)} disabled={isSpeaking} className="w-12 h-12 bg-white rounded-full shadow-lg border-2 border-orange-200 flex items-center justify-center">
            {volume > 0 ? <SpeakerWaveIcon className="w-6 h-6 text-orange-500" /> : <SpeakerXMarkIcon className="w-6 h-6 text-gray-400" />}
          </button>
        </div>
        <button onClick={handleSing} disabled={isSinging || isSpeaking} className="w-12 h-12 bg-white rounded-full shadow-lg border-2 border-pink-200 flex items-center justify-center disabled:opacity-50" title="让猫咪唱歌">
          <MusicalNoteIcon className="w-6 h-6 text-pink-400" />
        </button>
        <button onClick={handleFeed} disabled={isSpeaking} className="w-12 h-12 bg-white rounded-full shadow-lg border-2 border-blue-200 flex items-center justify-center disabled:opacity-50" title="投喂小鱼干">
          <span className="text-2xl">🐟</span>
        </button>
      </div>

      {showFishAnimation && (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
          {[...Array(8)].map((_, index) => (
            <div key={index} className="absolute animate-fish-fall" style={{ left: `${10 + index * 12}%`, animationDelay: `${index * 0.15}s`, fontSize: '2rem' }}>🐟</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
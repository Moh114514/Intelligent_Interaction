import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UserIcon, SparklesIcon, SpeakerWaveIcon, SpeakerXMarkIcon, MusicalNoteIcon } from '@heroicons/react/24/solid';
import { v4 as uuidv4 } from 'uuid';

import { AvatarMode, AvatarStage, loadAvatarMode } from './features/avatar';
import { DiagnosticsPanel } from './features/diagnostics';
import { ConversationPanel, SessionDrawer, appendMessage, createMessageHistory, MessageHistory, removeMessage, upsertModelMessage } from './features/conversation';
import { PcmRecorder, useAudioPlayback } from './features/speech';
import { BLACK_CAT_CONFIG, SOLDIER_CONFIG, WHITE_CAT_CONFIG } from './constants';
import { CatConfig, CatType } from './types';
import { AgentClient, AgentClientError } from './services/agentClient';
import { ToolConfirmationModal } from './components/ToolConfirmationModal';
import { AgentState, InteractionType, PersistedMessage, SessionSummary, ToolConfirmationRequiredData } from './generated/contracts';
import { SpeechClient, SpeechClientError } from './services/speechClient';
import { SessionClient } from './services/sessionClient';

function App() {
  const [currentCat, setCurrentCat] = useState<CatConfig>(BLACK_CAT_CONFIG);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(loadAvatarMode);
  const activeCharacter = avatarMode === 'three' ? SOLDIER_CONFIG : currentCat;
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [messages, setMessages] = useState<MessageHistory>(createMessageHistory);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechLevel, setSpeechLevel] = useState(0);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isSinging, setIsSinging] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showFishAnimation, setShowFishAnimation] = useState(false);
  const [showAngryCat, setShowAngryCat] = useState(false);
  const [pendingToolConfirmation, setPendingToolConfirmation] = useState<{
    sessionId: string;
    requestId: string;
    confirmation: ToolConfirmationRequiredData;
  } | null>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [hasGreeted, setHasGreeted] = useState<Record<CatType, boolean>>({
    [CatType.BLACK]: false,
    [CatType.WHITE]: false,
    [CatType.SOLDIER]: false
  });

  const agentClientRef = useRef(new AgentClient());
  const activeRequestRef = useRef<{ requestId: string; sessionId: string } | null>(null);
  const sessionClientRef = useRef(new SessionClient());
  const activeSessionIdRef = useRef<string | null>(null);
  const speechClientRef = useRef(new SpeechClient());
  const recorderRef = useRef(new PcmRecorder());
  const recordingRef = useRef(false);
  const greetingInProgressRef = useRef(new Set<CatType>());

  const handlePlaybackStart = useCallback(() => {
    setIsProcessingVoice(false);
    setIsSpeaking(true);
    setAgentState('speaking');
  }, []);
  const handlePlaybackIdle = useCallback(() => {
    setIsSpeaking(false);
    setIsSinging(false);
    setAgentState('idle');
  }, []);
  const { audioContextRef, playAudioBuffer, resetPlayback, resetQueue } = useAudioPlayback({
    volume,
    onPlaybackStart: handlePlaybackStart,
    onPlaybackIdle: handlePlaybackIdle,
    onLevel: setSpeechLevel
  });

  useEffect(() => () => {
    agentClientRef.current.disconnect();
    speechClientRef.current.cancelAll();
    recordingRef.current = false;
    void recorderRef.current.cancel();
  }, []);
  const refreshSessions = useCallback(async () => {
    const [active, archived] = await Promise.all([
      sessionClientRef.current.listSessions(false),
      sessionClientRef.current.listSessions(true)
    ]);
    setSessions(active);
    setArchivedSessions(archived);
    return active;
  }, []);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    const persisted = await sessionClientRef.current.messages(sessionId);
    const loaded = persisted.map((message: PersistedMessage) => ({
      id: message.id,
      role: message.role === 'assistant' ? 'model' as const : 'user' as const,
      text: message.content,
      characterId: message.character_id as CatType
    }));
    setMessages(loaded);
    setHasGreeted({
      [CatType.BLACK]: loaded.some((message) => message.role === 'model' && message.characterId === CatType.BLACK),
      [CatType.WHITE]: loaded.some((message) => message.role === 'model' && message.characterId === CatType.WHITE),
      [CatType.SOLDIER]: loaded.some((message) => message.role === 'model' && message.characterId === CatType.SOLDIER)
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [config, active] = await Promise.all([sessionClientRef.current.config(), refreshSessions()]);
        if (cancelled) return;
        setAvatarMode(config.avatar_mode);
        setCurrentCat(config.css_character === CatType.WHITE ? WHITE_CAT_CONFIG : BLACK_CAT_CONFIG);
        setVolume(config.volume);
        let sessionId = config.active_session_id && active.some((item) => item.id === config.active_session_id)
          ? config.active_session_id : active[0]?.id;
        if (!sessionId) {
          const created = await sessionClientRef.current.createSession();
          sessionId = created.id;
          await refreshSessions();
        }
        if (cancelled) return;
        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        await loadSessionMessages(sessionId);
        if (!cancelled) setSettingsReady(true);
      } catch (error) {
        console.warn('会话数据暂时不可用', error);
      }
    })();
    return () => { cancelled = true; };
  }, [loadSessionMessages, refreshSessions]);

  useEffect(() => {
    if (!settingsReady) return;
    void sessionClientRef.current.updateConfig({
      avatar_mode: avatarMode,
      css_character: currentCat.type === CatType.WHITE ? 'WHITE' : 'BLACK',
      volume
    }).catch(() => undefined);
  }, [avatarMode, currentCat.type, settingsReady, volume]);

  const speak = useCallback(async (text: string, cat: CatConfig) => {
    setIsProcessingVoice(true);
    try {
      const audio = await speechClientRef.current.synthesize(text, cat.type, uuidv4());
      const context = audioContextRef.current;
      if (!context) {
        setIsProcessingVoice(false);
        return;
      }
      const buffer = await context.decodeAudioData(audio.slice(0));
      playAudioBuffer(buffer);
    } catch (error) {
      if (!(error instanceof SpeechClientError) || error.errorCode !== 'SPEECH_CANCELLED') {
        console.warn('语音合成失败，文字回复仍可使用。', error);
      }
      setIsProcessingVoice(false);
    }
  }, [audioContextRef, playAudioBuffer]);
  const generate = useCallback(async (prompt: string, cat: CatConfig, speakResult = true, interactionType: InteractionType = 'message') => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) throw new Error('会话尚未就绪');
    let streamed = '';
    const request = agentClientRef.current.sendMessage(sessionId, cat.type, prompt, {
      onState: setAgentState,
      onDelta: (delta) => {
        streamed += delta;
        setMessages((previous) => upsertModelMessage(previous, cat.type, request.requestId, streamed));
      },
      onToolConfirmation: (confirmation) => {
        setPendingToolConfirmation({ sessionId, requestId: request.requestId, confirmation });
      },
      onToolResult: (result) => {
        setPendingToolConfirmation((previous) => (
          previous?.confirmation.tool_call_id === result.tool_call_id ? null : previous
        ));
      }
    });
    activeRequestRef.current = { requestId: request.requestId, sessionId };
    try {
      const response = await request.completion;
      setMessages((previous) => upsertModelMessage(previous, cat.type, request.requestId, response));
      void refreshSessions().catch(() => undefined);
      if (speakResult) await speak(response, cat);
      return response;
    } catch (error) {
      setMessages((previous) => removeMessage(previous, cat.type, request.requestId));
      if (!(error instanceof AgentClientError) || error.errorCode !== 'REQUEST_CANCELLED') {
        setAgentState('error');
        window.setTimeout(() => setAgentState((current) => current === 'error' ? 'idle' : current), 1500);
        const message = error instanceof Error ? error.message : 'The agent request failed';
        setMessages((previous) => appendMessage(previous, cat.type, 'model', `${cat.type === CatType.SOLDIER ? 'Report:' : 'Meow?'} ${message}`));
      }
      throw error;
    } finally {
      if (activeRequestRef.current?.requestId === request.requestId) activeRequestRef.current = null;
      setPendingToolConfirmation((previous) => previous?.requestId === request.requestId ? null : previous);
    }
  }, [refreshSessions, speak]);

  const handleStart = async () => {
    setIsStarted(true);
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume().catch(() => undefined);
    }
  };

  useEffect(() => {
    const catType = activeCharacter.type;
    if (!isStarted || !settingsReady || hasGreeted[catType] || greetingInProgressRef.current.has(catType)) return;
    const timer = window.setTimeout(() => {
      greetingInProgressRef.current.add(catType);
      setHasGreeted((previous) => ({ ...previous, [catType]: true }));
      setIsLoadingText(true);
      setIsProcessingVoice(true);
      setAgentState('thinking');
      void generate('这是你第一次见到主人，请用符合你性格的方式简短打招呼并介绍自己。', activeCharacter, true, 'greeting')
        .catch(() => undefined)
        .finally(() => {
          greetingInProgressRef.current.delete(catType);
          setIsLoadingText(false);
          setIsProcessingVoice(false);
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeCharacter, generate, hasGreeted, isStarted, settingsReady]);

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
    const cat = activeCharacter;
    setInputText('');
    setMessages((previous) => appendMessage(previous, cat.type, 'user', text));
    setIsLoadingText(true);
    setIsProcessingVoice(true);
    setAgentState('thinking');
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
    const cat = activeCharacter;
    setIsSinging(true);
    setIsLoadingText(true);
    setAgentState('thinking');
    setIsProcessingVoice(true);
    try {
      await generate('请唱一小段原创、轻松可爱的短歌，不要引用现有歌曲歌词。', cat, true, 'sing');
    } catch {
      setIsSinging(false);
    } finally {
      setIsLoadingText(false);
      setIsProcessingVoice(false);
    }
  };

  const handleFeed = async () => {
    if (isSpeaking || isLoadingText) return;
    const cat = activeCharacter;
    setShowFishAnimation(true);
    setAgentState('thinking');
    window.setTimeout(() => setShowFishAnimation(false), 2000);
    setIsLoadingText(true);
    setIsProcessingVoice(true);
    try {
      await generate('主人给你投喂了美味的小鱼干，请简短表达感谢。', cat, true, 'feed');
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
    await speak('干嘛——', activeCharacter);
    window.setTimeout(() => setShowAngryCat(false), 2000);
  };

  const stopListening = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsListening(false);
    setIsProcessingVoice(true);
    setAgentState('recognizing');
    try {
      const wav = await recorderRef.current.stop();
      const result = await speechClientRef.current.transcribe(wav, uuidv4());
      setInputText(result.text);
      setAgentState('idle');
    } catch (error) {
      if (!(error instanceof SpeechClientError) || error.errorCode !== 'SPEECH_CANCELLED') {
        const message = error instanceof Error ? error.message : '语音识别失败';
        setMessages((previous) => appendMessage(previous, activeCharacter.type, 'model', `语音识别失败：${message}`));
        setAgentState('error');
        window.setTimeout(() => setAgentState((current) => current === 'error' ? 'idle' : current), 1500);
      }
    } finally {
      setIsProcessingVoice(false);
    }
  }, [activeCharacter.type]);

  const startListening = async () => {
    if (recordingRef.current || isProcessingVoice) return;
    recordingRef.current = true;
    try {
      await recorderRef.current.start();
      if (!recordingRef.current) return;
      setIsListening(true);
      setAgentState('listening');
    } catch (error) {
      recordingRef.current = false;
      const message = error instanceof Error ? error.message : '无法访问麦克风';
      setMessages((previous) => appendMessage(previous, activeCharacter.type, 'model', `麦克风不可用：${message}`));
      setAgentState('error');
      window.setTimeout(() => setAgentState((current) => current === 'error' ? 'idle' : current), 1500);
    }
  };
  const handleToolDecision = useCallback((approved: boolean) => {
    const pending = pendingToolConfirmation;
    if (!pending) return;
    agentClientRef.current.respondToToolConfirmation(
      pending.sessionId,
      pending.requestId,
      pending.confirmation.confirmation_id,
      approved
    );
    setPendingToolConfirmation(null);
  }, [pendingToolConfirmation]);

  const handleInterrupt = async () => {
    const active = activeRequestRef.current;
    if (active) agentClientRef.current.cancel(active.sessionId, active.requestId);
    speechClientRef.current.cancelAll();
    recordingRef.current = false;
    await recorderRef.current.cancel();
    setIsListening(false);
    setIsProcessingVoice(false);
    setIsLoadingText(false);
    setIsSpeaking(false);
    setPendingToolConfirmation(null);
    setAgentState('idle');
    await resetPlayback();
  };

  const selectSession = useCallback(async (sessionId: string) => {
    await handleInterrupt();
    setSettingsReady(false);
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setMessages(createMessageHistory());
    await loadSessionMessages(sessionId);
    setSettingsReady(true);
    await sessionClientRef.current.updateConfig({ active_session_id: sessionId });
    setSessionDrawerOpen(false);
  }, [loadSessionMessages]);

  const createSession = useCallback(async () => {
    await handleInterrupt();
    const created = await sessionClientRef.current.createSession();
    await refreshSessions();
    await selectSession(created.id);
  }, [refreshSessions, selectSession]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    await sessionClientRef.current.updateSession(sessionId, { title });
    await refreshSessions();
  }, [refreshSessions]);

  const archiveSession = useCallback(async (sessionId: string) => {
    await handleInterrupt();
    await sessionClientRef.current.updateSession(sessionId, { archived: true });
    const remaining = await refreshSessions();
    if (sessionId === activeSessionIdRef.current) {
      if (remaining.length) await selectSession(remaining[0].id);
      else await createSession();
    }
  }, [createSession, refreshSessions, selectSession]);

  const restoreSession = useCallback(async (sessionId: string) => {
    await sessionClientRef.current.updateSession(sessionId, { archived: false });
    await refreshSessions();
  }, [refreshSessions]);
  const isThinking = isLoadingText || isProcessingVoice;
  const showInterrupt = isThinking || isSpeaking;

  return (
    <div className="min-h-screen flex flex-col items-center bg-amber-50 overflow-hidden fixed inset-0">
      {!isStarted && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl border-4 border-orange-200 text-center max-w-md">
            <div className="text-6xl mb-6 animate-bounce">🐈</div>
            <h2 className="text-3xl font-bold text-orange-600 mb-4">欢迎来到 Agent Chat</h2>
            <p className="text-gray-600 mb-6 text-lg">点击下方按钮开始与Agent协作。</p>
            <button onClick={handleStart} className="bg-gradient-to-r from-orange-400 to-orange-600 text-white px-10 py-4 rounded-full font-bold text-xl shadow-lg hover:scale-105 active:scale-95 transition-all">
              开始对话
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-md px-6 py-4 flex justify-between items-center z-20 flex-none">
        <div className="flex items-center gap-2"><button type="button" onClick={() => setSessionDrawerOpen(true)} className="rounded-lg bg-white px-2 py-1 text-xl shadow" title="会话列表">☰</button><h1 className="text-xl font-bold text-orange-600 tracking-wider flex items-center gap-2"><span>🐾</span>GARFIELD CHAT</h1></div>
        <button
          onClick={handleToggleCat}
          disabled={showInterrupt || avatarMode === 'three'}
          className={`flex items-center space-x-2 bg-white px-3 py-1.5 rounded-full shadow-md border-2 border-orange-200 ${showInterrupt || avatarMode === 'three' ? 'opacity-70 cursor-not-allowed' : 'hover:bg-orange-50'}`}
        >
          {avatarMode === 'three' ? (
            <><div className="rounded-full bg-emerald-700 p-1"><UserIcon className="h-3 w-3 text-white" /></div><span className="text-sm font-bold text-emerald-800">Vanguard</span></>
          ) : currentCat.type === CatType.BLACK ? (
            <><div className="p-1 bg-slate-800 rounded-full"><UserIcon className="w-3 h-3 text-white" /></div><span className="font-bold text-slate-700 text-sm">Kuro</span></>
          ) : (
            <><div className="p-1 bg-pink-400 rounded-full"><SparklesIcon className="w-3 h-3 text-white" /></div><span className="font-bold text-pink-500 text-sm">Shiro</span></>
          )}
        </button>
      </div>

      <div className="z-20 mb-2 flex rounded-full border-2 border-orange-200 bg-white p-1 shadow-sm" aria-label="角色显示模式">
        <button type="button" onClick={() => setAvatarMode('three')} className={`rounded-full px-4 py-1 text-sm font-semibold transition ${avatarMode === 'three' ? 'bg-orange-500 text-white' : 'text-slate-600'}`} aria-pressed={avatarMode === 'three'}>
          Three.js 3D
        </button>
        <button type="button" onClick={() => setAvatarMode('css')} className={`rounded-full px-4 py-1 text-sm font-semibold transition ${avatarMode === 'css' ? 'bg-orange-500 text-white' : 'text-slate-600'}`} aria-pressed={avatarMode === 'css'}>
          CSS 猫咪
        </button>
      </div>

      <SessionDrawer
        open={sessionDrawerOpen}
        sessions={sessions}
        archivedSessions={archivedSessions}
        activeSessionId={activeSessionId}
        onClose={() => setSessionDrawerOpen(false)}
        onCreate={() => void createSession()}
        onSelect={(id) => void selectSession(id)}
        onRename={(id, title) => void renameSession(id, title)}
        onArchive={(id) => void archiveSession(id)}
        onRestore={(id) => void restoreSession(id)}
      />

      <DiagnosticsPanel />

      <div className="flex-1 w-full max-w-md flex flex-col relative z-10">
        <div className="flex-1 flex items-center justify-center min-h-[250px]">
          <AvatarStage
            mode={avatarMode}
            state={agentState}
            speechLevel={speechLevel}
            config={currentCat}
            showAngryCat={showAngryCat}
            onMultipleClicks={handleMultipleClicks}
            onModeChange={setAvatarMode}
          />        </div>
        <ConversationPanel
          messages={messages}
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

      {pendingToolConfirmation && (
        <ToolConfirmationModal
          confirmation={pendingToolConfirmation.confirmation}
          onDecision={handleToolDecision}
        />
      )}

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

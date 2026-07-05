import React, { useEffect, useRef, useState } from 'react';
import { AgentState } from '../../generated/contracts';
import { CatConfig } from '../../types';
import { CatAvatar } from '../../components/CatAvatar';
import { AvatarMode } from './avatarMode';
import { ThreeAvatarScene } from './threeAvatarScene';

const STATE_PRESENTATION: Record<AgentState, { label: string; tone: string }> = {
  idle: { label: '待命', tone: 'bg-slate-700' },
  listening: { label: '倾听', tone: 'bg-blue-500 animate-pulse' },
  recognizing: { label: '识别', tone: 'bg-cyan-500 animate-pulse' },
  thinking: { label: '思考', tone: 'bg-violet-500 animate-pulse' },
  confirming: { label: '等待确认', tone: 'bg-amber-500 animate-pulse' },
  acting: { label: '执行工具', tone: 'bg-orange-500 animate-pulse' },
  speaking: { label: '说话', tone: 'bg-emerald-500 animate-pulse' },
  error: { label: '错误', tone: 'bg-red-600' }
};

type LoadState = 'loading' | 'ready' | 'error';

interface AvatarStageProps {
  mode: AvatarMode;
  state: AgentState;
  speechLevel: number;
  config: CatConfig;
  showAngryCat: boolean;
  onMultipleClicks: () => void;
  onModeChange: (mode: AvatarMode) => void;
}

export const AvatarStage: React.FC<AvatarStageProps> = ({
  mode, state, speechLevel, config, showAngryCat, onMultipleClicks, onModeChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ThreeAvatarScene | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode !== 'three' || !containerRef.current) return;
    setLoadState('loading');
    setProgress(0);
    setErrorMessage('');
    const scene = new ThreeAvatarScene(containerRef.current, {
      onProgress: setProgress,
      onReady: () => setLoadState('ready'),
      onError: (message) => {
        setErrorMessage(message);
        setLoadState('error');
      }
    });
    sceneRef.current = scene;
    scene.setState(state);
    scene.load('./models/vanguard-soldier.glb');
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [mode, attempt]);

  useEffect(() => sceneRef.current?.setState(state), [state]);
  useEffect(() => sceneRef.current?.setSpeechLevel(speechLevel), [speechLevel]);

  const presentation = STATE_PRESENTATION[state];
  if (mode === 'css') {
    return (
      <div className="relative flex h-full w-full items-center justify-center" data-avatar-mode="css" data-agent-state={state}>
        <CatAvatar
          config={config}
          isSpeaking={state === 'speaking'}
          speechLevel={speechLevel}
          isListening={state === 'listening'}
          isThinking={['recognizing', 'thinking', 'confirming', 'acting'].includes(state)}
          onCatClick={() => undefined}
          onMultipleClicks={onMultipleClicks}
          showAngryCat={showAngryCat}
        />
        <StateBadge label={presentation.label} tone={presentation.tone} />
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[250px] w-full overflow-hidden rounded-3xl border-2 border-orange-200 bg-slate-950 shadow-inner" data-avatar-mode="three" data-agent-state={state}>
      <div key={attempt} ref={containerRef} className="absolute inset-0" />
      <StateBadge label={presentation.label} tone={presentation.tone} />
      {loadState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/90 text-white" role="status">
          <span className="text-sm font-semibold">正在加载 3D 角色…</span>
          <div className="h-2 w-48 overflow-hidden rounded bg-slate-700">
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="text-xs text-slate-300">{Math.round(progress * 100)}%</span>
        </div>
      )}
      {loadState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/95 px-6 text-center text-white" role="alert">
          <strong>3D 角色加载失败</strong>
          <span className="text-xs text-slate-300">{errorMessage}</span>
          <div className="flex gap-2">
            <button className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold" onClick={() => setAttempt((value) => value + 1)}>重试 3D</button>
            <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800" onClick={() => onModeChange('css')}>切换到 CSS</button>
          </div>
        </div>
      )}
    </div>
  );
};

const StateBadge: React.FC<{ label: string; tone: string }> = ({ label, tone }) => (
  <div className={`absolute right-3 top-3 z-20 rounded-full px-3 py-1 text-xs font-bold text-white shadow ${tone}`} aria-live="polite">
    {label}
  </div>
);

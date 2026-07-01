import { useCallback, useEffect, useRef } from 'react';

interface AudioPlaybackOptions {
  volume: number;
  onPlaybackStart: () => void;
  onPlaybackIdle: () => void;
}

const createAudioContext = () => new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

export function useAudioPlayback({ volume, onPlaybackStart, onPlaybackIdle }: AudioPlaybackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);

  useEffect(() => {
    audioContextRef.current = createAudioContext();
    return () => { void audioContextRef.current?.close(); };
  }, []);

  const playAudioBuffer = useCallback((buffer: AudioBuffer) => {
    const context = audioContextRef.current;
    if (!context) return;
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(volume, context.currentTime);
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(context.destination);
    const startTime = Math.max(context.currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    onPlaybackStart();
    source.onended = () => {
      setTimeout(() => {
        if (context.currentTime >= nextStartTimeRef.current) onPlaybackIdle();
      }, 100);
    };
  }, [onPlaybackIdle, onPlaybackStart, volume]);

  const resetPlayback = useCallback(async () => {
    nextStartTimeRef.current = 0;
    if (audioContextRef.current) {
      try { await audioContextRef.current.close(); }
      catch (error) { console.warn('关闭音频上下文失败:', error); }
    }
    audioContextRef.current = createAudioContext();
  }, []);

  const resetQueue = useCallback(() => { nextStartTimeRef.current = 0; }, []);
  return { audioContextRef, playAudioBuffer, resetPlayback, resetQueue };
}

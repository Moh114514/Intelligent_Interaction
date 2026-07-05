import { useCallback, useEffect, useRef } from 'react';

interface AudioPlaybackOptions {
  volume: number;
  onPlaybackStart: () => void;
  onPlaybackIdle: () => void;
  onLevel?: (level: number) => void;
}

const createAudioContext = () => new (window.AudioContext || (window as any).webkitAudioContext)();

export function useAudioPlayback({ volume, onPlaybackStart, onPlaybackIdle, onLevel }: AudioPlaybackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<AudioBuffer[]>([]);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackStartingRef = useRef(false);
  const rafRef = useRef(0);

  useEffect(() => {
    audioContextRef.current = createAudioContext();
    return () => {
      cancelAnimationFrame(rafRef.current);
      currentSourceRef.current?.stop();
      void audioContextRef.current?.close();
    };
  }, []);

  const playNext = useCallback(async () => {
    if (playbackStartingRef.current || currentSourceRef.current || queueRef.current.length === 0) return;
    const context = audioContextRef.current;
    if (!context) return;
    playbackStartingRef.current = true;
    try {
      if (context.state === 'suspended') await context.resume();
      if (audioContextRef.current !== context || currentSourceRef.current) return;
      const buffer = queueRef.current.shift();
      if (!buffer) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      gain.gain.setValueAtTime(volume, context.currentTime);
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(context.destination);
      currentSourceRef.current = source;
      const samples = new Uint8Array(analyser.fftSize);
      const monitor = () => {
        if (currentSourceRef.current !== source) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        onLevel?.(Math.min(1, Math.sqrt(sum / samples.length) * 4));
        rafRef.current = requestAnimationFrame(monitor);
      };
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        analyser.disconnect();
        if (currentSourceRef.current !== source) return;
        currentSourceRef.current = null;
        cancelAnimationFrame(rafRef.current);
        onLevel?.(0);
        if (queueRef.current.length > 0) void playNext();
        else onPlaybackIdle();
      };
      source.start();
      onPlaybackStart();
      monitor();
    } catch (error) {
      queueRef.current = [];
      onLevel?.(0);
      onPlaybackIdle();
      console.warn('音频播放启动失败。', error);
    } finally {
      playbackStartingRef.current = false;
      if (!currentSourceRef.current && queueRef.current.length > 0) void playNext();
    }
  }, [onLevel, onPlaybackIdle, onPlaybackStart, volume]);

  const playAudioBuffer = useCallback((buffer: AudioBuffer) => {
    queueRef.current.push(buffer);
    void playNext();
  }, [playNext]);

  const stopAll = useCallback(() => {
    queueRef.current = [];
    const source = currentSourceRef.current;
    currentSourceRef.current = null;
    if (source) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    cancelAnimationFrame(rafRef.current);
    onLevel?.(0);
  }, [onLevel]);

  const resetPlayback = useCallback(async () => {
    stopAll();
    if (audioContextRef.current) await audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = createAudioContext();
  }, [stopAll]);

  return { audioContextRef, playAudioBuffer, resetPlayback, resetQueue: stopAll, stopAll };
}

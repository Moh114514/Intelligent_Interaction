import { describe, expect, it } from 'vitest';
import { loadAvatarMode, saveAvatarMode } from '../../features/avatar/avatarMode';

describe('avatar mode settings', () => {
  it('defaults to Three.js, migrates Unity, and persists CSS', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    expect(loadAvatarMode(storage)).toBe('three');
    values.set('garfield-chat.avatar-mode', 'unity');
    expect(loadAvatarMode(storage)).toBe('three');
    saveAvatarMode('css', storage);
    expect(loadAvatarMode(storage)).toBe('css');
  });
});
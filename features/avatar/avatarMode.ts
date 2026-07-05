export type AvatarMode = 'three' | 'css';

const STORAGE_KEY = 'garfield-chat.avatar-mode';

export function loadAvatarMode(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): AvatarMode {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value === 'css' ? 'css' : 'three';
  } catch {
    return 'three';
  }
}

export function saveAvatarMode(mode: AvatarMode, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage can be disabled; the current session still keeps the selection.
  }
}
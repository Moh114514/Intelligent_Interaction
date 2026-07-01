import { v4 as uuidv4 } from 'uuid';
import { CatType, ChatMessage } from '../../types';

export type MessageHistory = Record<CatType, ChatMessage[]>;

export const createMessageHistory = (): MessageHistory => ({
  [CatType.BLACK]: [],
  [CatType.WHITE]: []
});

export function appendMessage(
  history: MessageHistory,
  catType: CatType,
  role: ChatMessage['role'],
  text: string
): MessageHistory {
  return {
    ...history,
    [catType]: [...history[catType], { id: uuidv4(), role, text }]
  };
}

export function appendTranscript(
  history: MessageHistory,
  catType: CatType,
  role: ChatMessage['role'],
  text: string
): MessageHistory {
  if (!text) return history;
  const current = history[catType];
  const last = current[current.length - 1];
  if (last && last.role === role && !['.', '!', '?'].includes(last.text.slice(-1))) {
    return {
      ...history,
      [catType]: [...current.slice(0, -1), { ...last, text: `${last.text} ${text}` }]
    };
  }
  return appendMessage(history, catType, role, text);
}

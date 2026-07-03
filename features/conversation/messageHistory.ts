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

export function upsertModelMessage(
  history: MessageHistory,
  catType: CatType,
  id: string,
  text: string
): MessageHistory {
  const messages = history[catType];
  const index = messages.findIndex((message) => message.id === id);
  const next = index < 0
    ? [...messages, { id, role: 'model' as const, text }]
    : messages.map((message, messageIndex) => messageIndex === index ? { ...message, text } : message);
  return { ...history, [catType]: next };
}

export function removeMessage(history: MessageHistory, catType: CatType, id: string): MessageHistory {
  return { ...history, [catType]: history[catType].filter((message) => message.id !== id) };
}
import { v4 as uuidv4 } from 'uuid';
import { CatType, ChatMessage } from '../../types';

export type MessageHistory = ChatMessage[];
export const createMessageHistory = (): MessageHistory => [];
export function appendMessage(history: MessageHistory, catType: CatType, role: ChatMessage['role'], text: string): MessageHistory {
  return [...history, { id: uuidv4(), role, text, characterId: catType }];
}
export function upsertModelMessage(history: MessageHistory, catType: CatType, id: string, text: string): MessageHistory {
  const index = history.findIndex((message) => message.id === id);
  return index < 0
    ? [...history, { id, role: 'model', text, characterId: catType }]
    : history.map((message, messageIndex) => messageIndex === index ? { ...message, text, characterId: catType } : message);
}
export function removeMessage(history: MessageHistory, _catType: CatType, id: string): MessageHistory {
  return history.filter((message) => message.id !== id);
}

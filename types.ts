export enum CatType {
  BLACK = 'BLACK',
  WHITE = 'WHITE',
  SOLDIER = 'SOLDIER'
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export interface CatConfig {
  type: CatType;
  name: string;
  gender: 'male' | 'female';
  voiceName: string;
  avatarIdle: string;
  avatarTalk: string;
  themeColor: string;
}
export enum CatType {
    BLACK = 'BLACK',
    WHITE = 'WHITE'
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
    systemInstruction: string;
}
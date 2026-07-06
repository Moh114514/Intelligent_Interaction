import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';

interface ChatBubbleProps {
    messages: ChatMessage[];
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ messages }) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
        <div className="w-full max-w-md mx-auto h-56 sm:h-64 overflow-y-auto scrollbar-hide p-4 space-y-3 bg-white/40 backdrop-blur-md rounded-2xl border border-white/60 shadow-lg transition-all">
            {messages.length === 0 && (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm italic opacity-70">
                    开始一段新对话…
                </div>
            )}
            {messages.map((msg) => (
                <div 
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-[fadeIn_0.3s_ease-out]`}
                >
                    <div className={`
                        max-w-[85%] px-4 py-2.5 rounded-2xl text-sm font-medium shadow-sm break-words
                        ${msg.role === 'user' 
                            ? 'bg-orange-500 text-white rounded-br-none' 
                            : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'}
                    `}>
                        {msg.role === 'model' && msg.characterId && <div className="mb-1 text-[10px] font-bold uppercase text-orange-500">{msg.characterId === 'BLACK' ? 'Kuro' : msg.characterId === 'WHITE' ? 'Shiro' : 'Vanguard'}</div>}
                        {msg.text}
                    </div>
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
};

// Add fade-in animation
const style = document.createElement('style');
style.innerHTML = `
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
`;
document.head.appendChild(style);

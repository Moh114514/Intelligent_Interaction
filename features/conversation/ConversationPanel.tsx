import React from 'react';
import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/solid';
import { ChatBubble } from '../../components/ChatBubble';
import { ChatMessage } from '../../types';

interface ConversationPanelProps {
  messages: ChatMessage[];
  inputText: string;
  isListening: boolean;
  isProcessingVoice: boolean;
  isThinking: boolean;
  showInterrupt: boolean;
  onInputChange: (value: string) => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onSubmit: () => void;
  onInterrupt: () => void;
}

export function ConversationPanel({
  messages, inputText, isListening, isProcessingVoice, isThinking,
  showInterrupt, onInputChange, onStartListening,
  onStopListening, onSubmit, onInterrupt
}: ConversationPanelProps) {
  return (
    <>
      <div className="px-4 mb-4 w-full"><ChatBubble messages={messages} /></div>
      <div className="px-4 pb-6 w-full">
        <div className="bg-white p-2 rounded-3xl shadow-xl border-4 border-blue-200 relative transition-colors">
          <div className="flex items-center space-x-2">
            <button
              className={`p-3 rounded-full transition-all duration-200 active:scale-95 border-2 select-none touch-none ${isListening ? 'bg-red-500 text-white border-red-600 shadow-inner scale-110' : showInterrupt ? 'bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed opacity-50' : 'bg-blue-50 text-blue-500 border-blue-200 hover:bg-blue-100'}`}
              onMouseDown={!showInterrupt ? onStartListening : undefined}
              onMouseUp={!showInterrupt ? onStopListening : undefined}
              onMouseLeave={isListening ? onStopListening : undefined}
              onTouchStart={!showInterrupt ? onStartListening : undefined}
              onTouchEnd={isListening ? onStopListening : undefined}
              disabled={showInterrupt}
              title="Hold to speak"
            >
              <MicrophoneIcon className={`w-6 h-6 ${isListening ? 'animate-pulse' : ''}`} />
            </button>
            <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="flex-1 flex items-center bg-gray-50 rounded-full px-4 py-2 border-2 border-gray-200 focus-within:border-orange-400 transition-colors">
              <input
                type="text"
                value={inputText}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={isListening ? 'Listening...' : isProcessingVoice ? 'Thinking...' : 'Talk to me...'}
                className="bg-transparent w-full outline-none text-gray-700 placeholder-gray-400"
                disabled={isListening || isThinking}
              />
            </form>
            <button
              onClick={showInterrupt ? onInterrupt : onSubmit}
              disabled={(!inputText.trim() && !showInterrupt) || isListening}
              className={`p-2 rounded-full transition-all duration-200 ${((!inputText.trim() && !showInterrupt) || isListening) ? 'opacity-40 grayscale cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
              title={showInterrupt ? 'Stop' : 'Send'}
            >
              {showInterrupt ? (
                <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center shadow-lg border-b-4 border-red-700"><StopIcon className="w-6 h-6 text-white" /></div>
              ) : (
                <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center shadow-lg border-b-4 border-orange-700"><span className="text-xl" aria-hidden="true">🐾</span></div>
              )}
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] text-orange-300 mt-2 font-bold uppercase tracking-widest opacity-80">
          {isListening ? 'Listening...' : isProcessingVoice ? 'Thinking...' : 'Hold Mic to Chat'}
        </p>
      </div>
    </>
  );
}
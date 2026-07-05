import React, { useState, useEffect, useRef } from 'react';
import { CatConfig, CatType } from '../types';

interface CatAvatarProps {
    config: CatConfig;
    isSpeaking: boolean;
    speechLevel?: number;
    isListening: boolean;
    isThinking: boolean;
    onCatClick?: () => void;
    onMultipleClicks?: () => void; // 连续点击回调
    showAngryCat?: boolean; // 显示愤怒猫咪图片
}

export const CatAvatar: React.FC<CatAvatarProps> = ({ config, isSpeaking, speechLevel = 0, isListening, isThinking, onCatClick, onMultipleClicks, showAngryCat }) => {
    const [lookDirection, setLookDirection] = useState({ x: 0, y: 0 });
    const [isBlinking, setIsBlinking] = useState(false);
    const [isSleeping, setIsSleeping] = useState(false);
    const [isWaving, setIsWaving] = useState(false);
    const [isExcited, setIsExcited] = useState(false);
    const [thinkingAction, setThinkingAction] = useState<'normal' | 'tilt' | 'scratch' | 'lookAround'>('normal');
    const [clickCount, setClickCount] = useState(0);
    const clickTimerRef = useRef<number | null>(null);
    const hasTriggeredRef = useRef<boolean>(false); // 防止重复触发
    const eyesRef = useRef<HTMLDivElement>(null);
    const inactivityTimerRef = useRef<number | null>(null);
    const isBlack = config.type === CatType.BLACK;

    // Random blinking effect
    useEffect(() => {
        const blinkInterval = setInterval(() => {
            if (!isSpeaking && !isThinking && !isSleeping) {
                setIsBlinking(true);
                setTimeout(() => setIsBlinking(false), 150);
            }
        }, 3000 + Math.random() * 2000); // Random interval between 3-5 seconds
        
        return () => clearInterval(blinkInterval);
    }, [isSpeaking, isThinking, isSleeping]);

    // Sleeping after inactivity
    useEffect(() => {
        // Clear existing timer
        if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current);
        }
        
        // If actively doing something, wake up
        if (isSpeaking || isListening || isThinking) {
            setIsSleeping(false);
        }
        
        // Always start a new sleep timer (whether active or idle)
        inactivityTimerRef.current = window.setTimeout(() => {
            if (!isSpeaking && !isListening && !isThinking) {
                setIsSleeping(true);
            }
        }, 10000); // Sleep after 10 seconds of inactivity

        return () => {
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
            }
        };
    }, [isSpeaking, isListening, isThinking]);

    // Wave greeting on mount
    useEffect(() => {
        setIsWaving(true);
        const timer = setTimeout(() => setIsWaving(false), 2000);
        return () => clearTimeout(timer);
    }, []);

    // Thinking actions variety
    useEffect(() => {
        if (!isThinking) {
            setThinkingAction('normal');
            return;
        }

        const actions: Array<'normal' | 'tilt' | 'scratch' | 'lookAround'> = ['normal', 'tilt', 'scratch', 'lookAround'];
        let currentIndex = 0;

        const interval = setInterval(() => {
            currentIndex = (currentIndex + 1) % actions.length;
            setThinkingAction(actions[currentIndex]);
        }, 1500); // Change action every 1.5 seconds

        return () => clearInterval(interval);
    }, [isThinking]);

    // Handle cat click
    const handleCatClick = () => {
        if (isSleeping) {
            setIsSleeping(false);
            // Reset inactivity timer
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
            }
            inactivityTimerRef.current = window.setTimeout(() => {
                setIsSleeping(true);
            }, 10000);
        }
        
        // 检测连续点击
        setClickCount(prev => {
            const newCount = prev + 1;
            
            // 清除之前的定时器
            if (clickTimerRef.current) {
                clearTimeout(clickTimerRef.current);
            }
            
            // 如果点击次数达到 5 次且尚未触发，触发特殊反应
            if (newCount >= 5 && !hasTriggeredRef.current) {
                hasTriggeredRef.current = true; // 标记已触发
                if (onMultipleClicks) {
                    onMultipleClicks();
                }
                // 2秒后重置标志位和计数
                setTimeout(() => {
                    hasTriggeredRef.current = false;
                    setClickCount(0);
                }, 2000);
                return 0; // 重置计数
            }
            
            // 1 秒后重置计数和标志位
            clickTimerRef.current = window.setTimeout(() => {
                setClickCount(0);
                hasTriggeredRef.current = false;
            }, 1000);
            
            return newCount;
        });
        
        // Show excited animation
        setIsExcited(true);
        setTimeout(() => setIsExcited(false), 800);
        
        if (onCatClick) {
            onCatClick();
        }
    };

    // Garfield-style color palette
    const colors = isBlack ? {
        fur: 'bg-slate-800',
        furText: 'text-slate-800', // For SVG stroke
        furDark: 'bg-slate-900',
        muzzle: 'bg-slate-700', // Lighter muzzle for contrast
        earInner: 'bg-slate-600',
        eyeBg: 'bg-yellow-300', // Classic yellow cat eyes for black cat
        pupil: 'bg-black',
        nose: 'bg-pink-400',
        border: 'border-slate-900',
    } : {
        fur: 'bg-white',
        furText: 'text-white', // For SVG stroke
        furDark: 'bg-gray-100',
        muzzle: 'bg-gray-50',
        earInner: 'bg-pink-200',
        eyeBg: 'bg-white',
        pupil: 'bg-blue-900',
        nose: 'bg-pink-400',
        border: 'border-gray-300',
    };

    // Mouse Tracking Behavior
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!eyesRef.current || isThinking) return;

            const rect = eyesRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Calculate offset from center of eyes
            const deltaX = e.clientX - centerX;
            const deltaY = e.clientY - centerY;

            // Dampening factor to keep pupils within the eyeball area
            const sensitivity = 25; 
            const maxOffset = 14; // Maximum pixels the pupil can move

            const moveX = Math.max(-maxOffset, Math.min(maxOffset, deltaX / sensitivity));
            const moveY = Math.max(-maxOffset, Math.min(maxOffset, deltaY / sensitivity));

            setLookDirection({ x: moveX, y: moveY });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [isThinking]);

    // Dynamic pupil position based on state
    const getPupilStyle = () => {
        if (isSleeping) return { transform: 'translate(0px, 8px) scale(0.5)', opacity: 0 }; // Hidden when sleeping
        if (isExcited) return { transform: 'translate(0px, 0px) scale(1.5)' }; // Dilated when excited
        if (isThinking) {
            switch (thinkingAction) {
                case 'tilt': return { transform: 'translate(-10px, -5px)' };
                case 'scratch': return { transform: 'translate(12px, 8px)' };
                case 'lookAround': return { transform: `translate(${Math.sin(Date.now() / 500) * 12}px, -8px)` };
                default: return { transform: 'translate(0px, -8px)' }; // Look up
            }
        }
        if (isListening) return { transform: `translate(${lookDirection.x}px, ${lookDirection.y}px) scale(1.2)` }; // Dilate when listening, but still track
        return { transform: `translate(${lookDirection.x}px, ${lookDirection.y}px)` };
    };

    // Eyelid height based on state
    const getEyelidHeight = () => {
        if (isSleeping) return 'h-full'; // Fully closed when sleeping
        if (isBlinking) return 'h-[90%]'; // Almost closed when blinking
        if (isThinking) return 'h-0'; // Wide open when thinking
        return 'h-[35%]'; // Normal lazy look
    };

    const getContainerClass = () => {
        if (isSleeping) return '';
        if (isExcited) return 'animate-excited';
        if (isSpeaking) return 'animate-bounce-subtle';
        if (isThinking && thinkingAction === 'tilt') return 'animate-head-tilt';
        if (isThinking && thinkingAction === 'scratch') return 'animate-scratch';
        return 'animate-breathe';
    };

    // 如果显示愤怒猫咪图片，直接返回图片
    if (showAngryCat) {
        const angryCatSrc = `${import.meta.env.BASE_URL}angry-cat.png`;
        return (
            <div className="relative w-80 h-72 mx-auto flex items-center justify-center animate-shake">
                <img 
                    src={angryCatSrc}
                    alt="愤怒的猫咪" 
                    className="w-full h-full object-contain rounded-2xl"
                    style={{
                        filter: 'drop-shadow(0 0 20px rgba(255, 0, 0, 0.5))'
                    }}
                />
            </div>
        );
    }

    return (
        <div 
            className={`relative w-80 h-72 mx-auto flex items-end justify-center transition-transform duration-500 cursor-pointer hover:scale-105 ${getContainerClass()}`}
            onClick={handleCatClick}
        >
            
            {/* Background Aura for Listening */}
            {isListening && (
                <div className="absolute top-10 inset-0 bg-orange-300 rounded-full blur-3xl opacity-20 animate-pulse z-0"></div>
            )}

            {/* --- Long Tail (SVG) --- */}
            <div className="absolute -right-16 bottom-0 z-0 origin-bottom-left animate-tail-sway">
                <svg width="180" height="120" viewBox="0 0 180 120" fill="none" className="drop-shadow-md">
                    <path 
                        d="M 20 110 C 60 110, 80 20, 160 10" 
                        stroke="currentColor" 
                        strokeWidth="28" 
                        strokeLinecap="round"
                        className={colors.furText}
                    />
                </svg>
            </div>

            {/* --- The Body (Chubby Pear Shape) --- */}
            <div className={`absolute bottom-0 w-64 h-48 ${colors.fur} rounded-[50%_50%_45%_45%] z-10 shadow-xl`}>
                 {/* Tummy Patch */}
                 <div className={`absolute bottom-0 left-[15%] w-[70%] h-[80%] ${colors.muzzle} rounded-t-full opacity-50`}></div>
            </div>

            {/* --- Head Container --- */}
            <div className="relative z-20 w-64 h-56 mb-8">
                
                {/* Ears */}
                <div className={`absolute top-0 left-4 w-16 h-20 ${colors.fur} rounded-[50%_50%_0_0] -rotate-12 border-4 ${colors.border} border-b-0`}>
                    <div className={`absolute top-2 left-2 w-10 h-14 ${colors.earInner} rounded-full opacity-80`}></div>
                </div>
                <div className={`absolute top-0 right-4 w-16 h-20 ${colors.fur} rounded-[50%_50%_0_0] rotate-12 border-4 ${colors.border} border-b-0`}>
                    <div className={`absolute top-2 right-2 w-10 h-14 ${colors.earInner} rounded-full opacity-80`}></div>
                </div>

                {/* Main Face Shape (Oval) */}
                <div className={`absolute top-8 left-0 w-full h-44 ${colors.fur} rounded-[45%] shadow-lg border-b-4 ${colors.border}`}></div>

                {/* --- The "Garfield" Face Features --- */}
                <div className="absolute inset-0 z-30">
                    
                    {/* Eyes (Connected Ovals) */}
                    <div ref={eyesRef} className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center justify-center">
                        {/* Left Eye */}
                        <div className={`relative w-16 h-20 ${colors.eyeBg} rounded-[50%_0_50%_50%] border-4 ${colors.border} overflow-hidden -mr-1 z-10`}>
                             {/* Eyelid (The lazy look) */}
                             <div className={`absolute top-0 left-0 w-full ${getEyelidHeight()} ${colors.fur} border-b-4 ${colors.border} z-20 transition-all duration-150`}></div>
                             {/* Pupil */}
                             <div className={`absolute top-[50%] left-[50%] w-4 h-5 ${colors.pupil} rounded-full -ml-2 -mt-2 transition-transform duration-100 ease-out`} style={getPupilStyle()}>
                                <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-white rounded-full"></div>
                             </div>
                        </div>
                        
                        {/* Right Eye */}
                        <div className={`relative w-16 h-20 ${colors.eyeBg} rounded-[0_50%_50%_50%] border-4 ${colors.border} overflow-hidden -ml-1 z-10`}>
                             {/* Eyelid */}
                             <div className={`absolute top-0 left-0 w-full ${getEyelidHeight()} ${colors.fur} border-b-4 ${colors.border} z-20 transition-all duration-150`}></div>
                             {/* Pupil */}
                             <div className={`absolute top-[50%] left-[50%] w-4 h-5 ${colors.pupil} rounded-full -ml-2 -mt-2 transition-transform duration-100 ease-out`} style={getPupilStyle()}>
                                <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-white rounded-full"></div>
                             </div>
                        </div>
                    </div>

                    {/* Nose */}
                    <div className={`absolute top-[6.5rem] left-1/2 -translate-x-1/2 w-6 h-4 ${colors.nose} rounded-[40%] z-30 shadow-sm`}></div>

                    {/* Muzzle (Cheeks) */}
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 w-48 h-20 flex justify-center z-20">
                        {/* Left Cheek */}
                        <div className={`w-24 h-20 ${colors.muzzle} rounded-[40%] border-b-4 border-l-4 ${colors.border} -mr-4`}>
                            {/* Whiskers */}
                            <div className="absolute top-8 left-2 space-y-2">
                                <div className="w-12 h-0.5 bg-slate-400/50 rotate-3"></div>
                                <div className="w-12 h-0.5 bg-slate-400/50 -rotate-3"></div>
                                <div className="w-12 h-0.5 bg-slate-400/50 rotate-6"></div>
                            </div>
                        </div>
                        {/* Right Cheek */}
                        <div className={`w-24 h-20 ${colors.muzzle} rounded-[40%] border-b-4 border-r-4 ${colors.border} -ml-4`}>
                             {/* Whiskers */}
                            <div className="absolute top-8 right-2 space-y-2 flex flex-col items-end">
                                <div className="w-12 h-0.5 bg-slate-400/50 -rotate-3"></div>
                                <div className="w-12 h-0.5 bg-slate-400/50 rotate-3"></div>
                                <div className="w-12 h-0.5 bg-slate-400/50 -rotate-6"></div>
                            </div>
                        </div>
                    </div>

                    {/* Mouth */}
                    {isSpeaking ? (
                        <div className="absolute top-[8.5rem] left-1/2 -translate-x-1/2 w-8 h-10 bg-red-900 rounded-[50%] border-2 border-black overflow-hidden z-10" style={{ height: `${16 + speechLevel * 28}px` }}>
                            <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-6 h-6 bg-pink-400 rounded-full"></div>
                        </div>
                    ) : (
                        <div className="absolute top-[8.5rem] left-1/2 -translate-x-1/2 z-20">
                             {/* Simple smirk */}
                             <div className="w-10 h-4 border-b-4 border-black rounded-full opacity-20"></div>
                        </div>
                    )}

                </div>
            </div>

            {/* Paws (Leaning over UI usually, but here just chubby hands) */}
            <div className="absolute -bottom-2 left-16 z-40">
                <div className={`w-16 h-12 ${colors.fur} rounded-[40%] border-4 ${colors.border} flex items-end justify-center pb-2 gap-2 shadow-lg`}>
                    <div className="w-0.5 h-4 bg-black/20"></div>
                    <div className="w-0.5 h-5 bg-black/20"></div>
                    <div className="w-0.5 h-4 bg-black/20"></div>
                </div>
            </div>
            <div className={`absolute -bottom-2 right-16 z-40 transition-transform duration-500 ${isWaving ? 'animate-wave' : ''}`}>
                 <div className={`w-16 h-12 ${colors.fur} rounded-[40%] border-4 ${colors.border} flex items-end justify-center pb-2 gap-2 shadow-lg ${isSpeaking ? 'animate-pulse' : ''}`}>
                    <div className="w-0.5 h-4 bg-black/20"></div>
                    <div className="w-0.5 h-5 bg-black/20"></div>
                    <div className="w-0.5 h-4 bg-black/20"></div>
                </div>
            </div>

             {/* Thought Bubble for Thinking State */}
             {isThinking && (
                <div className="absolute -top-4 right-0 bg-white p-3 rounded-[50%] rounded-bl-none border-2 border-black animate-bounce z-50 shadow-lg">
                    <span className="text-2xl">💭</span>
                </div>
             )}

             {/* Sleep Indicator (Z's) */}
             {isSleeping && (
                <div className="absolute -top-2 left-4 flex flex-col items-start gap-2 z-50 animate-float">
                    <span className="text-3xl opacity-60 animate-pulse">Zzz</span>
                    <span className="text-2xl opacity-40 animate-pulse delay-300">Zz</span>
                    <span className="text-xl opacity-20 animate-pulse delay-500">Z</span>
                </div>
             )}

        </div>
    );
};

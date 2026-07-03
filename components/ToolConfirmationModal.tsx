import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ToolConfirmationRequiredData } from '../generated/contracts';

interface ToolConfirmationModalProps {
  confirmation: ToolConfirmationRequiredData;
  onDecision: (approved: boolean) => void;
}

export const ToolConfirmationModal: React.FC<ToolConfirmationModalProps> = ({
  confirmation,
  onDecision
}) => {
  const submitted = useRef(false);
  const remainingSeconds = useCallback(() => (
    Math.max(0, Math.ceil((Date.parse(confirmation.expires_at) - Date.now()) / 1000))
  ), [confirmation.expires_at]);
  const [remaining, setRemaining] = useState(remainingSeconds);

  const decide = useCallback((approved: boolean) => {
    if (submitted.current) return;
    submitted.current = true;
    onDecision(approved);
  }, [onDecision]);

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(remainingSeconds()), 250);
    return () => window.clearInterval(timer);
  }, [remainingSeconds]);

  useEffect(() => {
    if (remaining === 0) decide(false);
  }, [decide, remaining]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tool-confirmation-title">
      <div className="w-full max-w-md rounded-3xl border-4 border-amber-200 bg-white p-6 shadow-2xl">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-600">L2 · Confirmation required</div>
        <h2 id="tool-confirmation-title" className="mb-3 text-2xl font-bold text-gray-900">Allow file access?</h2>
        <p className="mb-4 break-words rounded-2xl bg-amber-50 p-4 text-sm font-medium text-gray-700">
          {confirmation.summary}
        </p>
        <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gray-500">
          <dt>Tool</dt><dd className="font-mono text-gray-700">{confirmation.tool_name}</dd>
          <dt>Expires</dt><dd className="font-semibold text-gray-700">{remaining}s</dd>
        </dl>
        <div className="flex gap-3">
          <button type="button" onClick={() => decide(false)} className="flex-1 rounded-full border-2 border-gray-200 px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">
            Reject
          </button>
          <button type="button" onClick={() => decide(true)} className="flex-1 rounded-full bg-orange-500 px-4 py-3 font-bold text-white hover:bg-orange-600">
            Allow once
          </button>
        </div>
      </div>
    </div>
  );
};
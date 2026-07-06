import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ToolConfirmationRequiredData } from '../generated/contracts';

interface ToolConfirmationModalProps {
  confirmation: ToolConfirmationRequiredData;
  onDecision: (approved: boolean) => void;
}

const ACTION_LABELS: Record<string, string> = {
  search: '确认搜索', read: '确认读取', create: '确认新建', replace: '确认覆盖', clipboard: '确认写入',
  remember: '确认记住', update: '确认修改', forget: '确认遗忘'
};
const TOOL_LABELS: Record<string, string> = {
  'files.search_names': '搜索本地文件', 'files.read_file': '读取本地文件', 'files.read_text': '读取共享文件',
  'files.create_text': '新建文本文件', 'files.replace_text': '覆盖文本文件', 'clipboard.write_text': '写入剪贴板',
  'memory.remember': '保存长期记忆', 'memory.update': '修改长期记忆', 'memory.forget': '永久删除长期记忆'
};
const COPY = {
  risk: 'L2 · 需要用户确认', title: '请确认此操作', target: '操作对象', content: '完整内容', characters: '个字符',
  backup: '覆盖前将创建带时间戳的备份文件。', tool: '工具', expires: '剩余时间', reject: '拒绝',
  allowOnce: '仅允许一次', protectedOperation: '受保护操作'
} as const;

export const ToolConfirmationModal: React.FC<ToolConfirmationModalProps> = ({ confirmation, onDecision }) => {
  const submitted = useRef(false);
  const remainingSeconds = useCallback(() => Math.max(0, Math.ceil((Date.parse(confirmation.expires_at) - Date.now()) / 1000)), [confirmation.expires_at]);
  const [remaining, setRemaining] = useState(remainingSeconds);
  const details = confirmation.details;
  const decide = useCallback((approved: boolean) => {
    if (submitted.current) return;
    submitted.current = true;
    onDecision(approved);
  }, [onDecision]);
  useEffect(() => { const timer = window.setInterval(() => setRemaining(remainingSeconds()), 250); return () => window.clearInterval(timer); }, [remainingSeconds]);
  useEffect(() => { if (remaining === 0) decide(false); }, [decide, remaining]);
  const actionLabel = ACTION_LABELS[details?.operation || ''] || COPY.allowOnce;
  const toolLabel = TOOL_LABELS[confirmation.tool_name] || COPY.protectedOperation;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="tool-confirmation-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border-4 border-amber-200 bg-white p-6 shadow-2xl">
        <div className="mb-2 text-xs font-bold tracking-widest text-amber-600">{COPY.risk}</div>
        <h2 id="tool-confirmation-title" className="mb-3 text-2xl font-bold text-gray-900">{COPY.title}</h2>
        <p className="mb-4 break-words rounded-2xl bg-amber-50 p-4 text-sm font-medium text-gray-700">{confirmation.summary}</p>
        {details?.target && <div className="mb-4"><div className="mb-1 text-xs font-bold tracking-wide text-gray-500">{COPY.target}</div><div className="break-all rounded-xl bg-gray-100 p-3 font-mono text-sm text-gray-800">{details.target}</div></div>}
        {details?.content != null && <div className="mb-4"><div className="mb-1 flex justify-between text-xs font-bold tracking-wide text-gray-500"><span>{COPY.content}</span><span>{details.content_length ?? details.content.length} {COPY.characters}</span></div><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">{details.content}</pre></div>}
        {details?.will_create_backup && <p className="mb-4 text-xs font-semibold text-amber-700">{COPY.backup}</p>}
        <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gray-500"><dt>{COPY.tool}</dt><dd className="font-semibold text-gray-700">{toolLabel}</dd><dt>{COPY.expires}</dt><dd className="font-semibold text-gray-700">{remaining} 秒</dd></dl>
        <div className="flex gap-3"><button type="button" onClick={() => decide(false)} className="flex-1 rounded-full border-2 border-gray-200 px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">{COPY.reject}</button><button type="button" onClick={() => decide(true)} className="flex-1 rounded-full bg-orange-500 px-4 py-3 font-bold text-white hover:bg-orange-600">{actionLabel}</button></div>
      </div>
    </div>
  );
};

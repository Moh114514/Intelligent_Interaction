import React, { useState } from 'react';
import type { SessionSummary } from '../../generated/contracts';

interface SessionDrawerProps {
  open: boolean; sessions: SessionSummary[]; archivedSessions: SessionSummary[]; activeSessionId: string | null;
  onClose: () => void; onOpenMemory?: () => void; onCreate: () => void; onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void; onArchive: (id: string) => void; onRestore: (id: string) => void;
}
export function SessionDrawer(props: SessionDrawerProps) {
  const [showArchived, setShowArchived] = useState(false);
  if (!props.open) return null;
  const items = showArchived ? props.archivedSessions : props.sessions;
  return <div className="fixed inset-0 z-[90] bg-black/35" onClick={props.onClose}>
    <aside className="h-full w-80 max-w-[85vw] bg-amber-50 p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-orange-700">会话</h2><button type="button" onClick={props.onClose} className="rounded-lg px-2 py-1 text-slate-500">关闭</button></div>
      <button type="button" onClick={() => props.onOpenMemory?.()} className="mt-3 w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-2 font-semibold text-orange-700">长期记忆</button>
      <button type="button" onClick={props.onCreate} className="mt-2 w-full rounded-xl bg-orange-500 px-4 py-2 font-semibold text-white">新建会话</button>
      <div className="mt-3 flex rounded-xl bg-white p-1"><button type="button" onClick={() => setShowArchived(false)} className={'flex-1 rounded-lg py-1 ' + (!showArchived ? 'bg-orange-100 text-orange-700' : 'text-slate-500')}>当前</button><button type="button" onClick={() => setShowArchived(true)} className={'flex-1 rounded-lg py-1 ' + (showArchived ? 'bg-orange-100 text-orange-700' : 'text-slate-500')}>已归档</button></div>
      <div className="mt-3 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {items.length === 0 && <p className="py-8 text-center text-sm text-slate-400">暂无会话</p>}
        {items.map((session) => <div key={session.id} className={'rounded-xl border p-3 ' + (session.id === props.activeSessionId ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white')}>
          <button type="button" onClick={() => !showArchived && props.onSelect(session.id)} className="w-full text-left"><div className="truncate font-semibold text-slate-700">{session.title}</div><div className="mt-1 truncate text-xs text-slate-400">{session.summary || '空会话'}</div><div className="mt-1 text-[10px] text-slate-400">{new Date(session.updated_at).toLocaleString('zh-CN')}</div></button>
          <div className="mt-2 flex gap-2 text-xs">{!showArchived ? <><button type="button" onClick={() => { const title = window.prompt('新的会话名称', session.title); if (title?.trim()) props.onRename(session.id, title.trim()); }} className="text-blue-600">重命名</button><button type="button" onClick={() => props.onArchive(session.id)} className="text-amber-700">归档</button></> : <button type="button" onClick={() => props.onRestore(session.id)} className="text-emerald-700">恢复</button>}</div>
        </div>)}
      </div>
    </aside>
  </div>;
}

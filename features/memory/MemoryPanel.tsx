import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LongTermMemory, MemoryCategory, MemoryPage, MemoryStatus } from '../../generated/contracts';
import { MEMORY_CATEGORIES, MemoryClient } from '../../services/memoryClient';

interface MemoryPanelProps { open: boolean; onClose: () => void; }
const PAGE_SIZE = 10;
const emptyPage: MemoryPage = { items: [], limit: PAGE_SIZE, offset: 0, has_more: false };

export function MemoryPanel({ open, onClose }: MemoryPanelProps) {
  const client = useRef(new MemoryClient());
  const [tab, setTab] = useState<MemoryStatus>('active');
  const [pages, setPages] = useState<Record<MemoryStatus, MemoryPage>>({ active: emptyPage, pending: emptyPage });
  const [offsets, setOffsets] = useState<Record<MemoryStatus, number>>({ active: 0, pending: 0 });
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('preference');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (status: MemoryStatus, offset = 0) => {
    try {
      const page = await client.current.list(status, PAGE_SIZE, offset);
      setPages((value) => ({ ...value, [status]: page }));
      setOffsets((value) => ({ ...value, [status]: offset }));
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取长期记忆'); }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load('active', 0);
    void load('pending', 0);
    const timer = window.setInterval(() => void load('pending', 0), 2000);
    return () => window.clearInterval(timer);
  }, [open, load]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); await Promise.all([load('active', 0), load('pending', 0)]); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '记忆操作失败'); }
    finally { setBusy(false); }
  }, [load]);

  const create = () => {
    const normalized = content.trim();
    if (!normalized) return;
    void mutate(async () => { await client.current.create({ content: normalized, category }); setContent(''); });
  };

  const edit = (memory: LongTermMemory) => {
    const next = window.prompt('修改记忆内容', memory.content)?.trim();
    if (!next) return;
    const nextCategory = window.prompt('分类：profile / preference / instruction / project', memory.category)?.trim() as MemoryCategory | undefined;
    if (!nextCategory || !MEMORY_CATEGORIES.some((item) => item.value === nextCategory)) return;
    const importance = Number(window.prompt('重要度（1-5）', String(memory.importance)));
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) return;
    void mutate(() => client.current.update(memory.id, { content: next, category: nextCategory, importance }));
  };

  const remove = (memory: LongTermMemory) => {
    const action = memory.status === 'pending' ? '驳回并删除候选' : '永久遗忘这条记忆';
    if (!window.confirm(`${action}？\n\n${memory.content}\n\n此操作无法恢复。`)) return;
    void mutate(() => client.current.delete(memory.id));
  };

  const page = pages[tab];
  const categoryName = useMemo(() => Object.fromEntries(MEMORY_CATEGORIES.map((item) => [item.value, item.label])), []);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="memory-title" onClick={onClose}>
      <section className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-3xl border-4 border-orange-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between">
          <div><h2 id="memory-title" className="text-2xl font-bold text-orange-700">长期记忆</h2><p className="text-xs text-slate-500">三个角色和所有会话共享；只有已批准记忆会参与回答。</p></div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1 text-slate-500">关闭</button>
        </header>
        <div className="mt-4 flex rounded-xl bg-orange-50 p-1">
          <button type="button" onClick={() => setTab('active')} className={'flex-1 rounded-lg py-2 font-semibold ' + (tab === 'active' ? 'bg-white text-orange-700 shadow' : 'text-slate-500')}>已批准</button>
          <button type="button" onClick={() => setTab('pending')} className={'flex-1 rounded-lg py-2 font-semibold ' + (tab === 'pending' ? 'bg-white text-orange-700 shadow' : 'text-slate-500')}>待确认 ({pages.pending.items.length})</button>
        </div>
        {tab === 'active' && <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50/50 p-3">
          <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} placeholder="手动添加一条长期记忆" className="h-20 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm" />
          <div className="mt-2 flex gap-2"><select value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} className="flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm">{MEMORY_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button type="button" disabled={busy || !content.trim()} onClick={create} className="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white disabled:opacity-50">添加</button></div>
        </div>}
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {page.items.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{tab === 'pending' ? '暂无待确认候选' : '暂无长期记忆'}</p>}
          {page.items.map((memory) => <article key={memory.id} className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">{categoryName[memory.category]}</span>{memory.pinned && <span className="ml-2 text-xs text-amber-600">已置顶</span>}<p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{memory.content}</p></div><span className="shrink-0 text-xs text-slate-400">重要度 {memory.importance}</span></div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
              {memory.status === 'pending' ? <><button disabled={busy} onClick={() => void mutate(() => client.current.approve(memory.id))} className="text-emerald-700">批准</button><button disabled={busy} onClick={() => edit(memory)} className="text-blue-700">编辑</button></> : <><button disabled={busy} onClick={() => void mutate(() => client.current.update(memory.id, { pinned: !memory.pinned }))} className="text-amber-700">{memory.pinned ? '取消置顶' : '置顶'}</button><button disabled={busy} onClick={() => edit(memory)} className="text-blue-700">编辑</button></>}
              <button disabled={busy} onClick={() => remove(memory)} className="text-red-700">{memory.status === 'pending' ? '驳回' : '永久遗忘'}</button>
            </div>
          </article>)}
        </div>
        <footer className="mt-3 flex items-center justify-between text-sm"><button type="button" disabled={offsets[tab] === 0} onClick={() => void load(tab, Math.max(0, offsets[tab] - PAGE_SIZE))} className="text-slate-600 disabled:opacity-30">上一页</button><span className="text-slate-400">第 {Math.floor(offsets[tab] / PAGE_SIZE) + 1} 页</span><button type="button" disabled={!page.has_more} onClick={() => void load(tab, offsets[tab] + PAGE_SIZE)} className="text-slate-600 disabled:opacity-30">下一页</button></footer>
      </section>
    </div>
  );
}


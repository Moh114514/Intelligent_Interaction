import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionDrawer } from '../../features/conversation/SessionDrawer';

describe('SessionDrawer', () => {
  it('renders active sessions, memory entry and archive controls', () => {
    const html = renderToStaticMarkup(<SessionDrawer open sessions={[{ id: 's1', title: 'Project', summary: 'Recent', archived: false, created_at: 'now', updated_at: 'now' }]} archivedSessions={[]} activeSessionId="s1" onClose={vi.fn()} onOpenMemory={vi.fn()} onCreate={vi.fn()} onSelect={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} />);
    expect(html).toContain('Project'); expect(html).toContain('\u957f\u671f\u8bb0\u5fc6'); expect(html).toContain('\u5f52\u6863'); expect(html).toContain('\u65b0\u5efa\u4f1a\u8bdd');
  });
});

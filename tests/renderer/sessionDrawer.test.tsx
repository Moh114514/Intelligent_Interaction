import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionDrawer } from '../../features/conversation/SessionDrawer';

describe('SessionDrawer', () => {
  it('renders active sessions and archive controls', () => {
    const html = renderToStaticMarkup(<SessionDrawer
      open
      sessions={[{ id: 's1', title: '项目讨论', summary: '最近回复', archived: false, created_at: 'now', updated_at: 'now' }]}
      archivedSessions={[]}
      activeSessionId="s1"
      onClose={vi.fn()} onCreate={vi.fn()} onSelect={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()}
    />);
    expect(html).toContain('项目讨论');
    expect(html).toContain('归档');
    expect(html).toContain('新建会话');
  });
});

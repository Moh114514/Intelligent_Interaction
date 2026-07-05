import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToolConfirmationModal } from '../../components/ToolConfirmationModal';

describe('ToolConfirmationModal', () => {
  it('用中文显示完整写入对象、内容、备份提示和操作按钮', () => {
    const markup = renderToStaticMarkup(React.createElement(ToolConfirmationModal, {
      confirmation: {
        confirmation_id: 'confirm-1',
        tool_call_id: 'call-1',
        tool_name: 'files.replace_text',
        risk_level: 'L2',
        summary: '覆盖文本文件并创建备份：D:\\Notes\\note.txt',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        details: {
          target: 'D:\\Notes\\note.txt',
          operation: 'replace',
          content: '第一行\n第二行',
          content_length: 7,
          will_create_backup: true
        }
      },
      onDecision: vi.fn()
    }));

    expect(markup).toContain('请确认此操作');
    expect(markup).toContain('D:\\Notes\\note.txt');
    expect(markup).toContain('第一行\n第二行');
    expect(markup).toContain('将创建带时间戳的备份文件');
    expect(markup).toContain('覆盖文本文件');
    expect(markup).toContain('确认覆盖');
    for (const english of ['Confirmation required', 'Review this operation', 'Target', 'Reject', 'Expires']) {
      expect(markup).not.toContain(english);
    }
  });
});
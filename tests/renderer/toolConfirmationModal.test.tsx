import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ToolConfirmationModal } from '../../components/ToolConfirmationModal';

describe('ToolConfirmationModal', () => {
  it('shows the exact write target, complete content, backup warning and action', () => {
    const markup = renderToStaticMarkup(React.createElement(ToolConfirmationModal, {
      confirmation: {
        confirmation_id: 'confirm-1',
        tool_call_id: 'call-1',
        tool_name: 'files.replace_text',
        risk_level: 'L2',
        summary: 'Replace searched text file with backup',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        details: {
          target: 'D:\\Notes\\note.txt',
          operation: 'replace',
          content: 'first line\nsecond line',
          content_length: 22,
          will_create_backup: true
        }
      },
      onDecision: vi.fn()
    }));

    expect(markup).toContain('D:\\Notes\\note.txt');
    expect(markup).toContain('first line\nsecond line');
    expect(markup).toContain('timestamped backup');
    expect(markup).toContain('Replace file');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemoryPanel } from '../../features/memory/MemoryPanel';

describe('MemoryPanel', () => {
  it('renders Chinese memory management and explicit safety copy', () => {
    const html = renderToStaticMarkup(<MemoryPanel open onClose={vi.fn()} />);
    expect(html).toContain('\u957f\u671f\u8bb0\u5fc6');
    expect(html).toContain('\u5df2\u6279\u51c6');
    expect(html).toContain('\u5f85\u786e\u8ba4');
  });
});

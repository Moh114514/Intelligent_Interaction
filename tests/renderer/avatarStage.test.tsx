import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AvatarStage } from '../../features/avatar/AvatarStage';
import { BLACK_CAT_CONFIG } from '../../constants';

describe('AvatarStage', () => {
  it('renders CSS and Three.js as explicit peer modes with state feedback', () => {
    const shared = { config: BLACK_CAT_CONFIG, showAngryCat: false, onMultipleClicks: vi.fn(), onModeChange: vi.fn() };
    const css = renderToStaticMarkup(<AvatarStage {...shared} mode="css" state="thinking" />);
    expect(css).toContain('data-avatar-mode="css"');
    expect(css).toContain('思考');

    const three = renderToStaticMarkup(<AvatarStage {...shared} mode="three" state="confirming" />);
    expect(three).toContain('data-avatar-mode="three"');
    expect(three).toContain('等待确认');
    expect(three).toContain('正在加载 3D 角色');
    expect(three).not.toContain('iframe');
  });
});
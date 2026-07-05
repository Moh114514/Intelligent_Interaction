import { describe, expect, it } from 'vitest';
import { computeCameraFrame, ThreeAvatarScene } from '../../features/avatar/threeAvatarScene';

describe('Three avatar camera framing', () => {
  it('exposes the speech envelope bridge used by AvatarStage', () => {
    expect(typeof ThreeAvatarScene.prototype.setSpeechLevel).toBe('function');
  });
  it('keeps a full body margin and adapts to narrow containers', () => {
    const wide = computeCameraFrame(1, 2, 1.5);
    const narrow = computeCameraFrame(1, 2, 0.3);
    expect(wide.targetY).toBeCloseTo(1.04);
    expect(wide.distance).toBeGreaterThan(3.9);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });
});

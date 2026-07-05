import { describe, expect, it } from 'vitest';
import { computeCameraFrame } from '../../features/avatar/threeAvatarScene';

describe('Three avatar camera framing', () => {
  it('keeps a full body margin and adapts to narrow containers', () => {
    const wide = computeCameraFrame(1, 2, 1.5);
    const narrow = computeCameraFrame(1, 2, 0.3);
    expect(wide.targetY).toBeCloseTo(1.04);
    expect(wide.distance).toBeGreaterThan(3.9);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });
});
import { describe, expect, it } from 'vitest';
import { orbitEye, pickBox, pixelRay, rayBox } from '../src/core/geometry.ts';
import type { Box } from '../src/core/types.ts';

const unit: Box = { center: [0, 0, 0], size: [1, 1, 1], yaw: 0 };

describe('rayBox', () => {
  it('hits a box straight ahead at the near face', () => {
    expect(rayBox([0, 0, 5], [0, 0, -1], unit)).toBeCloseTo(4.5);
  });
  it('misses a box beside the ray and one behind it', () => {
    expect(rayBox([2, 0, 5], [0, 0, -1], unit)).toBeNull();
    expect(rayBox([0, 0, 5], [0, 0, 1], unit)).toBeNull();
  });
  it('respects yaw: a thin box rotated 90 degrees is hit edge-on', () => {
    const thin: Box = { center: [0, 0, 0], size: [2, 1, 0.1], yaw: Math.PI / 2 };
    expect(rayBox([0, 0, 5], [0, 0, -1], thin)).toBeCloseTo(4);
  });
});

describe('camera picking', () => {
  const o = { target: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0, distance: 5, fov: 50 };
  it('puts the eye on +Z at yaw 0', () => {
    const e = orbitEye(o);
    expect(e[2]).toBeCloseTo(5);
  });
  it('the centre pixel picks the box at the target', () => {
    const { origin, dir } = pixelRay(o, 400, 300, 800, 600);
    expect(pickBox(origin, dir, [{ box: unit, id: 'a' }])?.id).toBe('a');
  });
  it('a corner pixel misses it', () => {
    const { origin, dir } = pixelRay(o, 0, 0, 800, 600);
    expect(pickBox(origin, dir, [{ box: unit, id: 'a' }])).toBeNull();
  });
  it('picks the nearer of two boxes', () => {
    const near = { box: { ...unit, center: [0, 0, 2] as [number, number, number] }, id: 'near' };
    const { origin, dir } = pixelRay(o, 400, 300, 800, 600);
    expect(pickBox(origin, dir, [{ box: unit, id: 'far' }, near])?.id).toBe('near');
  });
});

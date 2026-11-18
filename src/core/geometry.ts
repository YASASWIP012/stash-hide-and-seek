import type { Box, Vec3 } from './types.ts';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Orbit camera state. Yaw around +Y, pitch above the horizon, both in radians. */
export interface Orbit {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number; // vertical, degrees
}

export function orbitEye(o: Orbit): Vec3 {
  const cp = Math.cos(o.pitch);
  return add(o.target, [o.distance * cp * Math.sin(o.yaw), o.distance * Math.sin(o.pitch), o.distance * cp * Math.cos(o.yaw)]);
}

/** World-space ray through a pixel, for picking. (x, y) are pixels from the top-left. */
export function pixelRay(o: Orbit, x: number, y: number, width: number, height: number): { origin: Vec3; dir: Vec3 } {
  const eye = orbitEye(o);
  const fwd = norm(sub(o.target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const t = Math.tan(((o.fov * Math.PI) / 180) / 2);
  const ndcX = (2 * x) / width - 1;
  const ndcY = 1 - (2 * y) / height;
  const dir = norm(add(fwd, add(scale(right, ndcX * t * (width / height)), scale(up, ndcY * t))));
  return { origin: eye, dir };
}

/** Ray against a box rotated by `yaw` around Y (slab test in the box frame). Returns distance or null. */
export function rayBox(origin: Vec3, dir: Vec3, box: Box): number | null {
  const c = Math.cos(-box.yaw);
  const s = Math.sin(-box.yaw);
  const rot = (v: Vec3): Vec3 => [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
  const o = rot(sub(origin, box.center));
  const d = rot(dir);
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const half = box.size[i]! / 2;
    const oi = o[i]!;
    const di = d[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < -half || oi > half) return null;
      continue;
    }
    let t1 = (-half - oi) / di;
    let t2 = (half - oi) / di;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

/** Pick the nearest of several boxes along a ray. */
export function pickBox<T extends { box: Box }>(origin: Vec3, dir: Vec3, items: T[]): T | null {
  let best: T | null = null;
  let bestT = Infinity;
  for (const it of items) {
    const t = rayBox(origin, dir, it.box);
    if (t !== null && t < bestT) {
      best = it;
      bestT = t;
    }
  }
  return best;
}

/**
 * Pose of a moving part at joint fraction `f` (0 closed, 1 fully open).
 * Prismatic parts translate along the axis; revolute parts rotate about the axis through `origin`.
 */
export function jointValue(lower: number, upper: number, f: number): number {
  return lower + (upper - lower) * Math.min(1, Math.max(0, f));
}

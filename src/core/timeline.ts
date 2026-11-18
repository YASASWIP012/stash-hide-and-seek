import type { RobotEvent } from './search.ts';
import type { Vec2 } from './types.ts';
import { EN_VOICE, type Voice } from '../i18n.ts';

/** Snapshot of the robot replay at time t (seconds of simulated time). */
export interface ReplayFrame {
  robot: Vec2;
  heading: number;
  open: Record<string, number>; // joint fraction per container
  odds: Record<string, number> | null;
  next: string | null;
  say: string | null;
  done: boolean;
  found: boolean;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2);
const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Pure function from (events, t) to what the stage should show. Rendering is just
 * sampling this every frame, which keeps the replay exact and testable.
 */
export function sampleReplay(
  events: RobotEvent[],
  t: number,
  start: Vec2,
  labels: Record<string, string>,
  voice: Voice = EN_VOICE,
): ReplayFrame {
  const f: ReplayFrame = { robot: start, heading: Math.PI, open: {}, odds: null, next: null, say: null, done: false, found: false };
  for (const e of events) {
    if (e.t > t) break;
    switch (e.type) {
      case 'think': {
        f.odds = e.odds;
        f.next = e.next;
        f.say = voice.think(labels[e.next] ?? e.next, pct(e.odds[e.next] ?? 0));
        break;
      }
      case 'move': {
        const k = e.duration > 0 ? Math.min(1, (t - e.t) / e.duration) : 1;
        const g = ease(k);
        f.robot = [lerp(e.from[0], e.to[0], g), lerp(e.from[1], e.to[1], g)];
        const dx = e.to[0] - e.from[0], dz = e.to[1] - e.from[1];
        if (Math.hypot(dx, dz) > 1e-6) f.heading = Math.atan2(dx, dz);
        break;
      }
      case 'open': {
        const k = e.duration > 0 ? Math.min(1, (t - e.t) / e.duration) : 1;
        f.open[e.containerId] = ease(k);
        break;
      }
      case 'look':
        f.say = e.found ? voice.found : voice.notIn(labels[e.containerId] ?? e.containerId);
        break;
      case 'close': {
        const k = e.duration > 0 ? Math.min(1, (t - e.t) / e.duration) : 1;
        f.open[e.containerId] = 1 - ease(k);
        break;
      }
      case 'done':
        f.done = true;
        f.found = e.found;
        f.say = e.found ? voice.found : voice.giveUp;
        break;
    }
  }
  return f;
}

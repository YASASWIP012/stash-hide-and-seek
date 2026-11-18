import type { Container, HideLogEntry, RoomManifest, Vec2 } from './types.ts';

/** Tunable constants for the simulated robot. Every number here is a design choice, not a measurement. */
export const ROBOT = {
  speed: 0.6, // m/s across the floor
  jointSpeedLinear: 0.25, // m/s when pulling a drawer
  jointSpeedAngular: 1.2, // rad/s when swinging a door
  lookTime: 0.8, // seconds spent looking inside once open
  /** Pseudo-count given to the stated prior when mixing in logged hides. */
  priorWeight: 4,
} as const;

/** How likely a person is to pick each kind of container before any hides are logged. */
const KIND_WEIGHT: Record<Container['kind'], number> = {
  drawer: 1.0,
  cabinet: 0.9,
  wardrobe: 1.2,
  door: 0.5,
};

export function volume(c: Container): number {
  const [w, h, d] = c.box.size;
  return Math.max(w * h * d, 1e-6);
}

/**
 * The stated prior: bigger containers and container kinds people favour get more weight.
 * Cube root of volume keeps a wardrobe from swamping everything.
 */
export function statedPrior(containers: Container[]): Map<string, number> {
  const raw = containers.map((c) => [c.id, Math.cbrt(volume(c)) * KIND_WEIGHT[c.kind]] as const);
  return normalise(new Map(raw));
}

/**
 * Mix the stated prior with logged hides for this room (a Dirichlet-style posterior mean).
 * With few hides the prior dominates, which is the honest behaviour.
 */
export function beliefs(room: RoomManifest, log: HideLogEntry[]): Map<string, number> {
  const prior = statedPrior(room.containers);
  const counts = new Map<string, number>();
  let n = 0;
  for (const e of log) {
    if (e.roomId !== room.id || !prior.has(e.containerId)) continue;
    counts.set(e.containerId, (counts.get(e.containerId) ?? 0) + 1);
    n++;
  }
  const a = ROBOT.priorWeight;
  const out = new Map<string, number>();
  for (const [id, p] of prior) out.set(id, ((counts.get(id) ?? 0) + a * p) / (n + a));
  return out;
}

export function normalise(m: Map<string, number>): Map<string, number> {
  let s = 0;
  for (const v of m.values()) s += v;
  const out = new Map<string, number>();
  for (const [k, v] of m) out.set(k, s > 0 ? v / s : 0);
  return out;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function openDuration(c: Container): number {
  const travel = Math.abs(c.joint.upper - c.joint.lower);
  const speed = c.joint.type === 'prismatic' ? ROBOT.jointSpeedLinear : ROBOT.jointSpeedAngular;
  return travel / speed;
}

export type RobotEvent =
  | { t: number; type: 'think'; odds: Record<string, number>; next: string }
  | { t: number; type: 'move'; from: Vec2; to: Vec2; duration: number }
  | { t: number; type: 'open'; containerId: string; duration: number }
  | { t: number; type: 'look'; containerId: string; found: boolean }
  | { t: number; type: 'close'; containerId: string; duration: number }
  | { t: number; type: 'done'; found: boolean; containerId: string | null };

export interface SearchRun {
  events: RobotEvent[];
  foundAt: number | null; // seconds
  order: string[];
}

/**
 * Plan the robot's search. At each step it opens the container with the best
 * probability-per-second ratio (the classic index rule for searching boxes with costs),
 * then removes it from the belief if the object is not there.
 * Deterministic for a given room, log and hiding place, so a run can be replayed exactly.
 */
export function planSearch(
  room: RoomManifest,
  log: HideLogEntry[],
  hiddenIn: string,
  timeLimit = 60,
): SearchRun {
  const belief = beliefs(room, log);
  const remaining = new Map(room.containers.map((c) => [c.id, c]));
  const events: RobotEvent[] = [];
  const order: string[] = [];
  let pos: Vec2 = room.spawn;
  let t = 0;

  while (remaining.size > 0 && t < timeLimit) {
    const live = normalise(new Map([...belief].filter(([id]) => remaining.has(id))));
    let best: Container | null = null;
    let bestScore = -Infinity;
    for (const c of remaining.values()) {
      const cost = dist(pos, c.approach) / ROBOT.speed + openDuration(c) + ROBOT.lookTime;
      const score = (live.get(c.id) ?? 0) / cost;
      // Ties break on id so the plan is stable.
      if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && best && c.id < best.id)) {
        best = c;
        bestScore = score;
      }
    }
    if (!best) break;

    const travel = dist(pos, best.approach) / ROBOT.speed;
    // Out of time before it could finish looking: the search ends unfinished.
    if (t + travel + openDuration(best) + ROBOT.lookTime > timeLimit) break;
    events.push({ t, type: 'think', odds: Object.fromEntries(live), next: best.id });
    if (travel > 0) events.push({ t, type: 'move', from: pos, to: best.approach, duration: travel });
    t += travel;
    pos = best.approach;

    const od = openDuration(best);
    events.push({ t, type: 'open', containerId: best.id, duration: od });
    t += od;
    const found = best.id === hiddenIn;
    events.push({ t, type: 'look', containerId: best.id, found });
    t += ROBOT.lookTime;
    order.push(best.id);

    if (found) {
      events.push({ t, type: 'done', found: true, containerId: best.id });
      return { events, foundAt: t, order };
    }
    events.push({ t, type: 'close', containerId: best.id, duration: od * 0.6 });
    t += od * 0.6;
    remaining.delete(best.id);
  }

  events.push({ t: Math.min(t, timeLimit), type: 'done', found: false, containerId: null });
  return { events, foundAt: null, order };
}

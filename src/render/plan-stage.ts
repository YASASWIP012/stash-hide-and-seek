// Fallback stage: a top-down floor plan in SVG. Used when WebGL is unavailable or the 3D
// stage fails, so the game always stays playable.

import type { Box, RoomManifest, Vec2 } from '../core/types.ts';
import { jointValue, planFootprints } from '../core/geometry.ts';
import type { Stage } from './stage.ts';

const NS = 'http://www.w3.org/2000/svg';
const S = 100; // px per metre in the viewBox

function rect(b: Box, cls: string) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', String((-b.size[0] / 2) * S));
  r.setAttribute('y', String((-b.size[2] / 2) * S));
  r.setAttribute('width', String(b.size[0] * S));
  r.setAttribute('height', String(b.size[2] * S));
  r.setAttribute('rx', '4');
  r.setAttribute('class', cls);
  r.setAttribute('transform', `translate(${b.center[0] * S} ${b.center[2] * S}) rotate(${(-b.yaw * 180) / Math.PI})`);
  return r;
}

const LABEL_SIZE = 11;

/** Rough rendered width of a label in viewBox units: CJK glyphs are about square, Latin about 0.58 em. */
export function labelWidth(text: string, size = LABEL_SIZE): number {
  let w = 0;
  for (const ch of text) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.58;
  return w;
}

/** Shrink a label to fit a footprint (down to 7 units) and slide it so it stays inside [lo, hi]. */
export function fitLabel(text: string, width: number, x: number, lo: number, hi: number): { size: number; x: number } {
  const full = labelWidth(text);
  const size = full > width - 4 ? Math.max(7, (LABEL_SIZE * (width - 4)) / full) : LABEL_SIZE;
  const half = labelWidth(text, size) / 2;
  return { size, x: Math.min(Math.max(x, lo + half + 2), hi - half - 2) };
}

/** Width of a footprint as drawn on the plan (x extent after yaw). */
function footprintWidth(b: { size: [number, number, number]; yaw: number }): number {
  const c = Math.abs(Math.cos(b.yaw)), s = Math.abs(Math.sin(b.yaw));
  return b.size[0] * c + b.size[2] * s;
}

/** Words the floor plan shows or reads out, so it can be localised. */
export interface PlanText {
  aria: string;
  open: (label: string) => string;
  short: (label: string) => string;
}

export class PlanStage implements Stage {
  readonly kind = 'plan' as const;
  private svg: SVGSVGElement;
  private room: RoomManifest | null = null;
  private parts = new Map<string, { el: SVGRectElement; label: SVGTextElement }>();
  private foot = new Map<string, Box>();
  private open = new Map<string, number>();
  private robot: SVGGElement;
  private hiddenIn: string | null = null;
  private dot: SVGCircleElement;
  private cb: (id: string) => void = () => {};

  private text: PlanText;
  constructor(
    el: HTMLElement,
    text: PlanText = {
      aria: 'Floor plan of the room. Click a container to open it.',
      open: (label) => `Open ${label}`,
      short: (label) => label.replace(/^Dresser, /, '').replace(/ drawer$/, '').replace(/^Behind the room door$/, 'Door'),
    },
  ) {
    this.text = text;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'plan');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', this.text.aria);
    el.appendChild(this.svg);
    this.robot = document.createElementNS(NS, 'g');
    this.dot = document.createElementNS(NS, 'circle');
    this.dot.setAttribute('r', '7');
    this.dot.setAttribute('class', 'plan__object');
  }

  async load(room: RoomManifest): Promise<void> {
    this.room = room;
    const xs = room.floor.map((p) => p[0]), zs = room.floor.map((p) => p[1]);
    const pad = 0.2;
    const x0 = Math.min(...xs) - pad, z0 = Math.min(...zs) - pad;
    this.svg.setAttribute('viewBox', `${x0 * S} ${z0 * S} ${(Math.max(...xs) - x0 + pad) * S} ${(Math.max(...zs) - z0 + pad) * S}`);
    const floor = document.createElementNS(NS, 'polygon');
    floor.setAttribute('points', room.floor.map((p) => `${p[0] * S},${p[1] * S}`).join(' '));
    floor.setAttribute('class', 'plan__floor');
    this.svg.appendChild(floor);
    for (const f of room.fixtures) this.svg.appendChild(rect(f.box, 'plan__fixture'));
    this.foot = planFootprints(room.containers);
    for (const c of room.containers) {
      const fb = this.foot.get(c.id) ?? c.part ?? c.box;
      const r = rect(fb, 'plan__part');
      r.setAttribute('tabindex', '0');
      r.setAttribute('role', 'button');
      r.setAttribute('aria-label', this.text.open(c.label));
      const go = () => this.cb(c.id);
      r.addEventListener('click', go);
      r.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
      const t = document.createElementNS(NS, 'text');
      t.textContent = this.text.short(c.label);
      // Fit the label to its footprint and keep it inside the room, so side-by-side drawers stay readable.
      const fit = fitLabel(t.textContent, footprintWidth(fb) * S, fb.center[0] * S, (Math.min(...xs) - pad) * S, (Math.max(...xs) + pad) * S);
      t.setAttribute('x', String(fit.x));
      t.setAttribute('y', String(fb.center[2] * S + fit.size / 3));
      t.style.fontSize = `${fit.size}px`;
      t.setAttribute('class', 'plan__label');
      this.svg.append(r, t);
      this.parts.set(c.id, { el: r, label: t });
    }
    const body = document.createElementNS(NS, 'circle');
    body.setAttribute('r', '16');
    body.setAttribute('class', 'plan__robot');
    const nose = document.createElementNS(NS, 'path');
    nose.setAttribute('d', 'M -6 10 L 0 22 L 6 10 Z');
    nose.setAttribute('class', 'plan__robot');
    this.robot.append(body, nose);
    this.svg.append(this.dot, this.robot);
    this.setRobot(room.spawn, Math.PI);
    this.setHidden(null);
  }

  setOpen(containerId: string, fraction: number): void {
    const p = this.parts.get(containerId);
    const c = this.room?.containers.find((x) => x.id === containerId);
    if (!p || !c) return;
    this.open.set(containerId, fraction);
    const q = jointValue(c.joint.lower, c.joint.upper, fraction);
    const b = this.foot.get(c.id) ?? c.part ?? c.box;
    const base = `translate(${b.center[0] * S} ${b.center[2] * S}) rotate(${(-b.yaw * 180) / Math.PI})`;
    if (c.joint.type === 'prismatic') {
      p.el.setAttribute('transform', `${base} translate(0 ${q * S})`);
    } else {
      // Rotate about the hinge, expressed in the plan's coordinates.
      // A hinge on -Y (as Lux3D gives a left-hand door) turns the other way.
      const turn = c.joint.axis[1]! < 0 ? -q : q;
      p.el.setAttribute('transform', `rotate(${(-turn * 180) / Math.PI} ${c.joint.origin[0] * S} ${c.joint.origin[2] * S}) ${base}`);
    }
    p.el.classList.toggle('is-open', fraction > 0.5);
    this.updateDot();
  }

  setRobot(pos: Vec2, heading: number): void {
    this.robot.setAttribute('transform', `translate(${pos[0] * S} ${pos[1] * S}) rotate(${(-heading * 180) / Math.PI})`);
  }

  setHidden(containerId: string | null): void {
    this.hiddenIn = containerId;
    this.updateDot();
  }

  private updateDot() {
    const c = this.room?.containers.find((x) => x.id === this.hiddenIn);
    const shown = !!c && (this.open.get(c.id) ?? 0) > 0.5;
    this.dot.style.display = shown ? '' : 'none';
    if (c) {
      const fb = this.foot.get(c.id) ?? c.box;
      this.dot.setAttribute('cx', String(fb.center[0] * S));
      this.dot.setAttribute('cy', String(fb.center[2] * S));
    }
  }

  highlight(containerId: string | null): void {
    for (const [id, p] of this.parts) p.el.classList.toggle('is-target', id === containerId);
  }

  onPick(cb: (containerId: string) => void): void {
    this.cb = cb;
  }

  dispose(): void {
    this.svg.remove();
  }
}

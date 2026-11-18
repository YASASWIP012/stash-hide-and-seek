import type { RoomManifest, Vec2 } from '../core/types.ts';

/** What the game needs from a renderer. The 3D stage and the 2D plan both implement it. */
export interface Stage {
  readonly kind: '3d' | 'plan';
  load(room: RoomManifest, baseUrl: string): Promise<void>;
  /** Joint fraction: 0 closed, 1 fully open. */
  setOpen(containerId: string, fraction: number): void;
  setRobot(pos: Vec2, heading: number): void;
  /** Show or hide the hidden object inside a container (only drawn when that container is open). */
  setHidden(containerId: string | null, objectUrl: string | null): void;
  highlight(containerId: string | null): void;
  onPick(cb: (containerId: string) => void): void;
  dispose(): void;
}

export class StageError extends Error {}

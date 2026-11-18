// Shared data shapes. Units are metres and seconds; the world is Y-up.

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type ContainerKind = 'drawer' | 'door' | 'cabinet' | 'wardrobe';

export interface Box {
  center: Vec3;
  size: Vec3; // width (x), height (y), depth (z) before yaw
  yaw: number; // radians around +Y
}

export interface Joint {
  type: 'prismatic' | 'revolute';
  axis: Vec3; // unit vector in the container's local frame
  origin: Vec3; // pivot or slide origin in world space
  lower: number; // metres for prismatic, radians for revolute
  upper: number;
  /** Where the limits came from. Estimates are labelled as such in the UI and the URDF. */
  source: 'lux3d-articulation' | 'estimate';
  /** Tape-measured travel (metres or radians), when we have it. */
  measured?: number;
}

export interface Container {
  id: string;
  label: string;
  kind: ContainerKind;
  box: Box;
  joint: Joint;
  /** Where the robot stands to open it, on the floor plane (x, z). */
  approach: Vec2;
  /** Shape of the moving part in its closed pose (drawer box or door panel). Defaults to `box`. */
  part?: Box;
  /** GLB produced by Lux3D for the moving part, if generated. Relative to the site root. */
  mesh?: string;
}

/** A static piece of furniture rendered from a Lux3D model (or a box when no model is ready). */
export interface Fixture {
  id: string;
  label: string;
  box: Box;
  mesh?: string;
}

/** One real API call that produced part of this room. Shown on the "how it was made" page. */
export interface Provenance {
  step: string; // e.g. "lux3d.img-to-3d"
  taskId: string;
  credits: number;
  date: string; // ISO date
  artifact?: string; // file in the room folder
  note?: string;
}

export interface RoomManifest {
  id: string;
  title: string;
  /** Credit line for the person whose room this is, used only with their permission. */
  owner: string | null;
  capturedOn: string | null;
  /** "placeholder" rooms are hand-built stand-ins and are labelled on screen. */
  status: 'real' | 'placeholder';
  splat?: { url: string; format: 'sog' | 'ply' | 'spz'; up: Vec3 };
  floor: Vec2[]; // floor polygon (x, z)
  spawn: Vec2; // robot start
  fixtures: Fixture[];
  containers: Container[];
  provenance: Provenance[];
}

export interface HideLogEntry {
  roomId: string;
  containerId: string;
  at: string; // ISO timestamp
}

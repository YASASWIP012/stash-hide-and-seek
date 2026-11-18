// 3D stage on Aholo Viewer. Fixtures are the Lux3D models; moving parts follow the joint
// data in the room manifest. Picking uses our own ray test against the container boxes,
// so it does not depend on renderer internals.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GLTFLoader,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
  createViewer,
  downloadTexture,
  setViewerConfig,
  BackgroundMode,
} from '@manycore/aholo-viewer';
import type { Box, Container, RoomManifest, Vec2, Vec3 } from '../core/types.ts';
import { jointValue, orbitEye, pickBox, pixelRay, type Orbit } from '../core/geometry.ts';
import { StageError, type Stage } from './stage.ts';

type Rgb = [number, number, number];
const HIGHLIGHT: Rgb = [0.3, 0.42, 1];

function boxGeometry(w: number, h: number, d: number) {
  const x = w / 2, y = h / 2, z = d / 2;
  // 6 faces x 4 vertices, each face with its own normal.
  const faces: [Vec3, Vec3[]][] = [
    [[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]],
    [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
    [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]],
    [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
  ];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  faces.forEach(([n, vs], f) => {
    vs.forEach((v) => {
      pos.push(...v);
      nor.push(...n);
    });
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

const hex = (c: Rgb) => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
const mat = (c: Rgb) => new MeshPhongMaterial({ color: hex(c) });

function boxMesh(b: Box, c: Rgb, material = mat(c)) {
  const m = new Mesh(boxGeometry(b.size[0], b.size[1], b.size[2]), material);
  m.position.set(...b.center);
  m.rotation.y = b.yaw;
  return m;
}

interface PartNode {
  c: Container;
  node: Object3D; // pivot for doors, the part itself for drawers
  closed: Box;
  open: number;
  material: InstanceType<typeof MeshPhongMaterial>;
  base: Rgb;
  /** For parts drawn with a Lux3D mesh: a thin plate on the front, shown only while highlighted. */
  plate?: Object3D;
}

export class AholoStage implements Stage {
  readonly kind = '3d' as const;
  private readonly el: HTMLElement;
  private viewer: ReturnType<typeof createViewer>;
  private camera: PerspectiveCamera;
  private orbit: Orbit = { target: [0, 0.8, -0.2], yaw: 0.5, pitch: 0.55, distance: 4.6, fov: 50 };
  private parts = new Map<string, PartNode>();
  private room: RoomManifest | null = null;
  private robot: Object3D | null = null;
  private hidden: Object3D | null = null;
  private hiddenIn: string | null = null;
  private pickCb: (id: string) => void = () => {};
  private frame = 0;
  private dirty = true;
  private cleanup: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    try {
      this.viewer = createViewer('stash', el, { antialiasing: true });
    } catch (e) {
      throw new StageError(`3D renderer unavailable: ${(e as Error).message}`);
    }
    const r = el.getBoundingClientRect();
    this.camera = new PerspectiveCamera(this.orbit.fov, Math.max(r.width, 1) / Math.max(r.height, 1), 0.05, 100);
    this.viewer.setCamera(this.camera);
    setViewerConfig(this.viewer, {
      pipeline: {
        Background: { background: { active: BackgroundMode.BasicBackground, basic: { color: new Color(0.055, 0.06, 0.09) } }, ground: { enabled: false } },
        TAA: { enabled: false },
      },
    });
    const scene = this.viewer.getScene();
    scene.add(new AmbientLight(0xffffff, 0.75));
    const sun = new DirectionalLight(0xffffff, 0.9);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    this.bindInput();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (!this.dirty) return;
      this.dirty = false;
      this.applyCamera();
      this.viewer.render();
    };
    this.frame = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => {
      const b = el.getBoundingClientRect();
      this.viewer.resize();
      this.camera.aspect = Math.max(b.width, 1) / Math.max(b.height, 1);
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    });
    ro.observe(el);
    this.cleanup.push(() => ro.disconnect());
  }

  private applyCamera() {
    const e = orbitEye(this.orbit);
    this.camera.position.set(...e);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(new Vector3(...this.orbit.target));
  }

  private bindInput() {
    let down: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, yaw: this.orbit.yaw, pitch: this.orbit.pitch, moved: false };
      this.el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 4) down.moved = true;
      if (!down.moved) return;
      this.orbit.yaw = down.yaw - dx * 0.006;
      this.orbit.pitch = Math.min(1.35, Math.max(0.12, down.pitch + dy * 0.004));
      this.dirty = true;
    };
    const onUp = (e: PointerEvent) => {
      if (down && !down.moved && this.room) {
        const r = this.el.getBoundingClientRect();
        const { origin, dir } = pixelRay(this.orbit, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
        const hit = pickBox(origin, dir, this.room.containers);
        if (hit) this.pickCb(hit.id);
      }
      down = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.orbit.distance = Math.min(8, Math.max(2, this.orbit.distance * (1 + e.deltaY * 0.001)));
      this.dirty = true;
    };
    this.el.addEventListener('pointerdown', onDown);
    this.el.addEventListener('pointermove', onMove);
    this.el.addEventListener('pointerup', onUp);
    this.el.addEventListener('wheel', onWheel, { passive: false });
    this.cleanup.push(() => {
      this.el.removeEventListener('pointerdown', onDown);
      this.el.removeEventListener('pointermove', onMove);
      this.el.removeEventListener('pointerup', onUp);
      this.el.removeEventListener('wheel', onWheel);
    });
  }

  private async loadGlb(url: string): Promise<Object3D> {
    const res = await fetch(url);
    if (!res.ok) throw new StageError(`model ${url} returned ${res.status}`);
    const parsed = await GLTFLoader.loadGLTF(await res.arrayBuffer(), { textureLoader: (u: string) => downloadTexture(u) as never });
    return parsed.scene;
  }

  async load(room: RoomManifest, baseUrl: string): Promise<void> {
    this.room = room;
    const scene = this.viewer.getScene();
    // Floor and two back walls give the room its shape.
    const xs = room.floor.map((p) => p[0]), zs = room.floor.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    scene.add(boxMesh({ center: [cx, -0.02, cz], size: [w, 0.04, d], yaw: 0 }, [0.36, 0.31, 0.27]));
    scene.add(boxMesh({ center: [cx, 1.3, z0 - 0.03], size: [w, 2.6, 0.06], yaw: 0 }, [0.82, 0.8, 0.76]));
    scene.add(boxMesh({ center: [x0 - 0.03, 1.3, cz], size: [0.06, 2.6, d], yaw: 0 }, [0.78, 0.76, 0.72]));
    scene.add(boxMesh({ center: [x1 + 0.03, 1.3, cz], size: [0.06, 2.6, d], yaw: 0 }, [0.78, 0.76, 0.72]));

    // Fixtures: Lux3D models when available, a plain box if a model fails to load.
    await Promise.all(
      room.fixtures.map(async (f) => {
        try {
          if (!f.mesh) throw new Error('no mesh');
          const node = await this.loadGlb(`${baseUrl}${f.mesh}`);
          node.position.set(...(f.meshOrigin ?? f.box.center));
          node.rotation.y = f.box.yaw;
          scene.add(node);
        } catch {
          scene.add(boxMesh(f.box, [0.55, 0.42, 0.3]));
        }
      }),
    );

    for (const c of room.containers) {
      const closed = c.part ?? c.box;
      const color: Rgb = c.kind === 'door' ? [0.9, 0.88, 0.84] : [0.62, 0.47, 0.33];
      const material = mat(color);
      if (c.joint.type === 'revolute') {
        // Pivot at the hinge; the panel hangs off it.
        const pivot = new Object3D();
        pivot.position.set(...c.joint.origin);
        const panel = boxMesh(
          { ...closed, center: [closed.center[0] - c.joint.origin[0], closed.center[1] - c.joint.origin[1], closed.center[2] - c.joint.origin[2]] },
          color,
          material,
        );
        pivot.add(panel);
        scene.add(pivot);
        this.parts.set(c.id, { c, node: pivot, closed, open: 0, material, base: color });
      } else {
        const lux = c.mesh ? await this.partMesh(`${baseUrl}${c.mesh}`, c, closed) : null;
        if (lux) {
          scene.add(lux.node);
          this.parts.set(c.id, { c, node: lux.node, closed, open: 0, material: lux.material, base: HIGHLIGHT, plate: lux.plate });
        } else {
          const node = boxMesh(closed, color, material);
          scene.add(node);
          this.parts.set(c.id, { c, node, closed, open: 0, material, base: color });
        }
      }
    }

    this.robot = new Object3D();
    const body = boxMesh({ center: [0, 0.16, 0], size: [0.34, 0.24, 0.34], yaw: 0 }, [0.18, 0.27, 1]);
    const head = boxMesh({ center: [0, 0.36, 0.04], size: [0.2, 0.14, 0.18], yaw: 0 }, [0.92, 0.93, 0.97]);
    this.robot.add(body);
    this.robot.add(head);
    scene.add(this.robot);
    this.setRobot(room.spawn, Math.PI);
    this.dirty = true;
  }

  /**
   * A Lux3D part mesh rides on a node at the part's closed centre. The mesh's own frame is the
   * joint frame from articulation, so it is offset by (joint origin - centre). Null if it fails to load.
   */
  private async partMesh(url: string, c: Container, closed: Box) {
    try {
      const glb = await this.loadGlb(url);
      const node = new Object3D();
      node.position.set(...closed.center);
      node.rotation.y = closed.yaw;
      glb.position.set(c.joint.origin[0] - closed.center[0], c.joint.origin[1] - closed.center[1], c.joint.origin[2] - closed.center[2]);
      node.add(glb);
      const material = mat(HIGHLIGHT);
      const plate = boxMesh({ center: [0, 0, closed.size[2] / 2 + 0.008], size: [closed.size[0] * 0.98, closed.size[1] * 0.96, 0.012], yaw: 0 }, HIGHLIGHT, material);
      plate.visible = false;
      node.add(plate);
      return { node, plate, material };
    } catch (e) {
      console.warn(`part mesh ${url} failed, using a box`, e);
      return null;
    }
  }

  setOpen(containerId: string, fraction: number): void {
    const p = this.parts.get(containerId);
    if (!p) return;
    p.open = fraction;
    const q = jointValue(p.c.joint.lower, p.c.joint.upper, fraction);
    if (p.c.joint.type === 'revolute') {
      p.node.rotation.y = q;
    } else {
      // Slide along the joint axis, rotated into the container's yaw.
      const [ax, , az] = p.c.joint.axis;
      const s = Math.sin(p.closed.yaw), co = Math.cos(p.closed.yaw);
      const wx = co * ax + s * az, wz = -s * ax + co * az;
      p.node.position.set(p.closed.center[0] + wx * q, p.closed.center[1], p.closed.center[2] + wz * q);
    }
    this.placeHidden();
    this.dirty = true;
  }

  setRobot(pos: Vec2, heading: number): void {
    if (!this.robot) return;
    this.robot.position.set(pos[0], 0, pos[1]);
    this.robot.rotation.y = heading;
    this.dirty = true;
  }

  setHidden(containerId: string | null, objectUrl: string | null): void {
    const scene = this.viewer.getScene();
    if (this.hidden) {
      scene.remove(this.hidden);
      this.hidden = null;
    }
    this.hiddenIn = containerId;
    if (!containerId || !objectUrl) return;
    void this.loadGlb(objectUrl)
      .then((n) => {
        n.scale.set(1.6, 1.6, 1.6);
        this.hidden = n;
        scene.add(n);
        this.placeHidden();
      })
      .catch(() => {
        const n = boxMesh({ center: [0, 0, 0], size: [0.08, 0.04, 0.06], yaw: 0 }, [0.95, 0.2, 0.2]);
        this.hidden = n;
        scene.add(n);
        this.placeHidden();
      });
  }

  private placeHidden() {
    if (!this.hidden || !this.hiddenIn) return;
    const p = this.parts.get(this.hiddenIn);
    if (!p) return;
    const visible = p.open > 0.5;
    this.hidden.visible = visible;
    if (p.c.joint.type === 'prismatic') {
      const n = p.node.position;
      this.hidden.position.set(n.x, n.y + p.closed.size[1] / 2 - 0.02, n.z);
    } else {
      const b = p.c.box;
      this.hidden.position.set(b.center[0], b.center[1] - b.size[1] / 2 + 0.06, b.center[2]);
    }
    this.dirty = true;
  }

  highlight(containerId: string | null): void {
    for (const [id, p] of this.parts) {
      if (p.plate) {
        p.plate.visible = id === containerId;
        continue;
      }
      const c = id === containerId ? HIGHLIGHT : p.base;
      p.material.color = new Color(c[0], c[1], c[2]).cloneReadonly();
    }
    this.dirty = true;
  }

  onPick(cb: (containerId: string) => void): void {
    this.pickCb = cb;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((f) => f());
    this.viewer.destroy();
  }
}

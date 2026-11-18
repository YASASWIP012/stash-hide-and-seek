import './style.css';
import type { HideLogEntry, RoomManifest } from './core/types.ts';
import { planSearch, type SearchRun } from './core/search.ts';
import { sampleReplay } from './core/timeline.ts';
import { decodeHide, encodeHide, type SharedHide } from './core/share.ts';
import { roomToUrdf } from './core/urdf.ts';
import type { Stage } from './render/stage.ts';
import { PlanStage } from './render/plan-stage.ts';

interface ObjectEntry {
  id: string;
  label: string;
  file: string;
  taskId: string;
  step: string;
}

const BASE = import.meta.env.BASE_URL;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const REPLAY_SPEED = 2; // the robot replay plays at 2x so a round stays short

// ---------- small per-viewer storage (never required for the game to work) ----------
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode: fine */
    }
  },
};

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(`${BASE}${path}`, { cache: 'no-cache' });
    return r.ok ? ((await r.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Try the 3D stage; fall back to the floor plan if WebGL or the renderer is unavailable. */
async function makeStage(el: HTMLElement, room: RoomManifest, forcePlan: boolean): Promise<Stage> {
  if (!forcePlan) {
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2')) throw new Error('no WebGL2');
      const { AholoStage } = await import('./render/aholo-stage.ts');
      const s = new AholoStage(el);
      await s.load(room, BASE);
      return s;
    } catch (e) {
      console.warn('3D stage failed, using the floor plan', e);
      el.replaceChildren();
    }
  }
  const s = new PlanStage(el);
  await s.load(room);
  return s;
}

type Phase = 'hide' | 'robot' | 'result' | 'seek' | 'seek-done';

async function boot() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') ?? 'demo';
  const room = await getJson<RoomManifest | null>(`rooms/${roomId}/room.json`, null);
  if (!room) {
    $('#stage').textContent = 'This room could not be loaded. Try reloading the page.';
    return;
  }
  const objects = await getJson<ObjectEntry[]>('objects/index.json', []);
  const hideables = objects.filter((o) => !['dresser', 'nightstand', 'wardrobe'].includes(o.id));
  const seedLog = await getJson<HideLogEntry[]>(`rooms/${room.id}/hides.json`, []);
  const labels = Object.fromEntries(room.containers.map((c) => [c.id, c.label]));

  renderRoomInfo(room);
  renderHowItsMade(room, objects);
  renderExport(room);

  const stageEl = $('#stage');
  const stage = await makeStage(stageEl, room, params.get('plan') === '1');
  $('#renderer').textContent = stage.kind === '3d' ? 'Aholo Viewer' : 'Floor plan (3D unavailable)';

  let phase: Phase = 'hide';
  let objectId = hideables[0]?.id ?? 'keys';
  let hiddenIn: string | null = null;
  let run: SearchRun | null = null;
  let raf = 0;
  let shared: SharedHide | null = null;
  let seekStart = 0;
  let seekOpened = new Set<string>();

  const objUrl = (id: string) => {
    const o = objects.find((x) => x.id === id) ?? live.get(id);
    return o ? (o.file.startsWith('http') ? o.file : `${BASE}${o.file}`) : null;
  };
  const live = new Map<string, ObjectEntry>();

  // ---------- object chips ----------
  const chips = $('#objects');
  const drawChips = () => {
    chips.replaceChildren(
      ...[...hideables, ...live.values()].map((o) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = o.label;
        b.setAttribute('aria-pressed', String(o.id === objectId));
        b.addEventListener('click', () => {
          objectId = o.id;
          drawChips();
        });
        return b;
      }),
    );
  };
  drawChips();

  // ---------- phases ----------
  const setPhase = (p: Phase) => {
    phase = p;
    document.body.dataset.phase = p;
    const steps: Record<Phase, string> = {
      hide: 'Pick an object, then click a drawer, the wardrobe or the door to hide it.',
      robot: 'The robot is searching. It opens the spot it rates best per second of effort.',
      result: '',
      seek: 'Your friend hid something here. Click to open drawers and doors. The clock is running.',
      'seek-done': '',
    };
    $('#instructions').textContent = steps[p];
  };

  const resetRoom = () => {
    cancelAnimationFrame(raf);
    for (const c of room.containers) stage.setOpen(c.id, 0);
    stage.setRobot(room.spawn, Math.PI);
    stage.highlight(null);
    stage.setHidden(null, null);
    renderOdds(null, null);
    $('#say').textContent = '';
    $('#clock').textContent = '0.0 s';
    $('#result').hidden = true;
  };

  const playRobot = () => {
    if (!hiddenIn) return;
    const log = [...seedLog, ...store.get<HideLogEntry[]>('stash.hides', [])];
    run = planSearch(room, log, hiddenIn);
    setPhase('robot');
    const t0 = performance.now();
    const end = (run.events.at(-1)?.t ?? 0) + 0.6;
    const tick = () => {
      const t = ((performance.now() - t0) / 1000) * REPLAY_SPEED;
      const f = sampleReplay(run!.events, t, room.spawn, labels);
      stage.setRobot(f.robot, f.heading);
      for (const c of room.containers) stage.setOpen(c.id, f.open[c.id] ?? 0);
      stage.highlight(f.next);
      renderOdds(f.odds, f.next);
      $('#say').textContent = f.say ?? '';
      $('#clock').textContent = `${Math.min(t, run!.foundAt ?? 60).toFixed(1)} s`;
      if (t < end) raf = requestAnimationFrame(tick);
      else finishRobot();
    };
    raf = requestAnimationFrame(tick);
  };

  const finishRobot = () => {
    setPhase('result');
    const found = run?.foundAt != null;
    const robotTime = run?.foundAt ?? 60;
    $('#result-title').textContent = found
      ? `The robot found it in ${robotTime.toFixed(1)} s.`
      : 'The robot ran out of time. You out-hid it.';
    $('#result-body').textContent = found
      ? `It opened ${run!.order.length} ${run!.order.length === 1 ? 'spot' : 'spots'}. Send the hide to a friend and see if they beat the robot.`
      : 'Send the hide to a friend and see if a person does better.';
    const token = encodeHide({ v: 1, room: room.id, container: hiddenIn!, object: objectId, hiderTime: robotTime });
    const url = `${location.origin}${location.pathname}?room=${room.id}#h=${token}`;
    ($('#share-url') as HTMLInputElement).value = url;
    $('#result').hidden = false;
  };

  stage.onPick((id) => {
    if (phase === 'hide') {
      hiddenIn = id;
      const log = store.get<HideLogEntry[]>('stash.hides', []);
      log.push({ roomId: room.id, containerId: id, at: new Date().toISOString() });
      store.set('stash.hides', log.slice(-200));
      stage.setHidden(id, objUrl(objectId));
      stage.setOpen(id, 1);
      $('#say').textContent = `Hidden in: ${labels[id]}. The robot starts in a moment.`;
      setTimeout(() => {
        stage.setOpen(id, 0);
        setTimeout(playRobot, 500);
      }, 900);
    } else if (phase === 'seek' && shared) {
      if (seekOpened.has(id)) return;
      seekOpened.add(id);
      stage.setOpen(id, 1);
      if (id === shared.container) {
        const t = (performance.now() - seekStart) / 1000;
        setPhase('seek-done');
        cancelAnimationFrame(raf);
        const robot = shared.hiderTime;
        $('#result-title').textContent =
          robot !== undefined && t < robot ? `You found it in ${t.toFixed(1)} s. You beat the robot.` : `You found it in ${t.toFixed(1)} s.`;
        $('#result-body').textContent =
          robot !== undefined ? `The robot needed ${robot.toFixed(1)} s on the same hide. You opened ${seekOpened.size} spots.` : '';
        ($('#share-url') as HTMLInputElement).value = location.href.split('#')[0]!;
        $('#result').hidden = false;
      } else {
        setTimeout(() => stage.setOpen(id, 0), 700);
      }
    }
  });

  $('#again').addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    shared = null;
    hiddenIn = null;
    resetRoom();
    setPhase('hide');
  });
  $('#copy').addEventListener('click', async () => {
    const v = ($('#share-url') as HTMLInputElement).value;
    try {
      await navigator.clipboard.writeText(v);
      $('#copy').textContent = 'Copied';
    } catch {
      ($('#share-url') as HTMLInputElement).select();
    }
  });

  // ---------- a friend opened a shared link ----------
  const startFromHash = () => {
    const token = location.hash.match(/#h=([^&]+)/)?.[1];
    const h = token ? decodeHide(token) : null;
    if (!h || h.room !== room.id || !labels[h.container]) {
      if (token) $('#say').textContent = 'That link looks broken, so here is a fresh round instead.';
      return false;
    }
    shared = h;
    resetRoom();
    stage.setHidden(h.container, objUrl(h.object));
    setPhase('seek');
    seekOpened = new Set();
    seekStart = performance.now();
    const tick = () => {
      $('#clock').textContent = `${((performance.now() - seekStart) / 1000).toFixed(1)} s`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    $('#say').textContent = h.hiderTime !== undefined ? `Time to beat: the robot took ${h.hiderTime.toFixed(1)} s.` : '';
    document.getElementById('play')?.scrollIntoView({ behavior: 'smooth' });
    return true;
  };
  if (!startFromHash()) setPhase('hide');
  window.addEventListener('hashchange', startFromHash);

  // ---------- live generation (optional, spends 1 credit on the server) ----------
  const form = $<HTMLFormElement>('#make-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('#make-input');
    const prompt = input.value.trim();
    if (!prompt) return;
    const status = $('#make-status');
    const btn = $<HTMLButtonElement>('#make-btn');
    btn.disabled = true;
    status.textContent = 'Lux3D is generating your object. This usually takes 20 to 40 seconds.';
    try {
      type R = { ok: boolean; done?: boolean; glbUrl?: string; taskId?: string; reason?: string };
      const start = (await (await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })).json()) as R;
      if (!start.ok || !start.taskId) throw new Error(start.reason ?? 'generation failed');
      let j: R = start;
      for (let i = 0; i < 40 && !j.done; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        j = (await (await fetch(`/api/generate?taskId=${start.taskId}`)).json()) as R;
        if (!j.ok) throw new Error(j.reason ?? 'generation failed');
      }
      if (!j.glbUrl) throw new Error('it took too long');
      const id = `live-${start.taskId}`;
      live.set(id, { id, label: prompt.slice(0, 24), file: j.glbUrl, taskId: start.taskId, step: 'lux3d.text-to-3d.turbo' });
      objectId = id;
      drawChips();
      status.textContent = `Done. Task ${start.taskId}. It is now selected: hide it in the room above.`;
    } catch (err) {
      status.textContent = `Live generation is unavailable right now (${(err as Error).message}). The ready-made objects still work.`;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- static sections ----------
function renderOdds(odds: Record<string, number> | null, next: string | null) {
  const list = $('#odds');
  const room = (window as unknown as { __room?: RoomManifest }).__room;
  if (!odds) {
    list.replaceChildren();
    return;
  }
  const entries = Object.entries(odds).sort((a, b) => b[1] - a[1]);
  list.replaceChildren(
    ...entries.map(([id, p]) => {
      const li = document.createElement('li');
      li.className = id === next ? 'is-next' : '';
      const label = room?.containers.find((c) => c.id === id)?.label ?? id;
      li.innerHTML = `<span class="odds__label"></span><span class="odds__bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span><span class="odds__pct t-mono">${Math.round(p * 100)}%</span>`;
      li.querySelector('.odds__label')!.textContent = label;
      return li;
    }),
  );
}

function renderRoomInfo(room: RoomManifest) {
  (window as unknown as { __room?: RoomManifest }).__room = room;
  const badge = $('#room-status');
  badge.textContent =
    room.status === 'placeholder'
      ? 'Placeholder room. Furniture is real Lux3D output; the moving parts are estimated boxes until the first phone scan is processed.'
      : `Real room${room.owner ? ` from ${room.owner}` : ''}, scanned ${room.capturedOn ?? ''}.`;
}

function renderHowItsMade(room: RoomManifest, objects: ObjectEntry[]) {
  const list = $('#provenance');
  if (!room.provenance.length) {
    list.innerHTML = '<li class="t-small">No API results recorded for this room yet.</li>';
    return;
  }
  list.replaceChildren(
    ...room.provenance.map((p) => {
      const li = document.createElement('li');
      li.className = 'prov';
      const obj = objects.find((o) => p.artifact?.endsWith(`${o.id}.glb`));
      li.innerHTML = `<span class="prov__step t-mono"></span><span class="prov__what"></span><span class="prov__meta t-mono"></span>`;
      li.querySelector('.prov__step')!.textContent = p.step;
      li.querySelector('.prov__what')!.textContent = obj ? `${obj.label}: ${p.note ?? ''}` : (p.note ?? p.artifact ?? '');
      li.querySelector('.prov__meta')!.textContent = `task ${p.taskId} · ${p.credits} credit${p.credits === 1 ? '' : 's'} · ${p.date}`;
      return li;
    }),
  );
}

function renderExport(room: RoomManifest) {
  $('#urdf-btn').addEventListener('click', () => {
    const blob = new Blob([roomToUrdf(room)], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${room.id}.urdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const est = room.containers.filter((c) => c.joint.source === 'estimate').length;
  $('#urdf-note').textContent = `${room.containers.length} moving parts. ${est} of them have estimated joint limits, labelled as such inside the file.`;
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('stage');
  if (el) el.textContent = 'Something went wrong loading the room. Reload to try again.';
});

// Reveal-on-scroll for marketing sections.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), {
    rootMargin: '0px 0px -8% 0px',
  });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
} else document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));

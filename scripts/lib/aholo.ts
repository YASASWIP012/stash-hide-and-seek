// Aholo Open Platform client used by the offline pipeline. It never runs in the browser,
// so the API key stays on this machine (or in the server function's environment).
//
// Every paid call goes through `spend()`, which checks the credit rule, then the disk cache,
// then calls the API, then records the result and the ledger entry. Tests inject a fake fetch.

import { createHash } from 'node:crypto';
import { COST, decideSpend, type CallKind } from '../../src/core/credits.ts';
import type { Cache } from './cache.ts';
import type { Ledger } from './ledger.ts';

export const API_BASE = 'https://api.aholo.ai';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  cache: Cache;
  ledger: Ledger;
  /** Credits the owner approved for this run (from --approve). */
  approvedUpTo?: number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

interface Envelope<T> {
  c?: string;
  m?: string;
  d?: T;
}

export class AholoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** Lux3D task terminal states from the API docs: 3 succeeded, 4 failed, 6 cancelled. */
const LUX_DONE = 3;
const LUX_FAILED = new Set([4, 6]);

export interface TaskResult {
  kind: CallKind;
  taskId: string;
  outputs: string[];
  raw: unknown;
  cached: boolean;
}

export class AholoClient {
  private readonly o: Required<Omit<ClientOptions, 'approvedUpTo'>> & { approvedUpTo: number };

  constructor(opts: ClientOptions) {
    this.o = {
      fetch: (u, i) => fetch(u, i),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      pollMs: 4000,
      timeoutMs: 30 * 60 * 1000,
      log: () => {},
      approvedUpTo: 0,
      ...opts,
    };
    if (!this.o.apiKey) throw new Error('AHOLO_API_KEY is missing. Put it in .env.local.');
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.o.fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: this.o.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AholoError(`HTTP_${res.status}`, text.slice(0, 200));
    }
    if (!res.ok) {
      const e = json as { status?: string; message?: string; m?: string };
      throw new AholoError(e.status ?? `HTTP_${res.status}`, e.message ?? e.m ?? text.slice(0, 200));
    }
    return json as T;
  }

  /** Lux3D endpoints wrap results in { c, m, d }; c === "0" is success. */
  private async lux<T>(method: string, path: string, body?: unknown): Promise<T> {
    const env = await this.call<Envelope<T>>(method, path, body);
    if (env.c !== '0') throw new AholoError(env.c ?? 'UNKNOWN', env.m ?? 'request failed');
    return env.d as T;
  }

  /**
   * Upload a local file through OUS and return its public URL. Free. Files above the
   * single-upload block size go through the multipart flow.
   */
  async upload(bytes: Uint8Array, name: string): Promise<string> {
    const t = await this.call<{ ousToken: string; globalDomain: string; blockSize: number }>('GET', '/global/asset/v1/token');
    const md5 = createHash('md5').update(bytes).digest('hex');
    const ous = (path: string, init: RequestInit) =>
      this.o.fetch(`${t.globalDomain}${path}`, { ...init, headers: { ...(init.headers ?? {}), 'ous-token-v2': t.ousToken } });
    const env = async <T>(r: Response): Promise<T> => {
      const j = (await r.json()) as Envelope<T>;
      if (j.c !== '0') throw new AholoError(j.c ?? `HTTP_${r.status}`, j.m ?? 'upload failed');
      return j.d as T;
    };
    const blob = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'application/octet-stream' });

    if (bytes.byteLength <= t.blockSize) {
      const form = new FormData();
      form.set('md5', md5);
      form.set('file', blob(bytes), name);
      await env(await ous('/ous/api/v2/single/upload', { method: 'POST', body: form }));
    } else {
      const blocks = Math.ceil(bytes.byteLength / t.blockSize);
      const q = new URLSearchParams({ md5, blocks: String(blocks), size: String(bytes.byteLength), name });
      const init = await env<{ deduplicated?: boolean | null }>(await ous(`/ous/api/v2/block/upload/init?${q}`, { method: 'POST' }));
      if (!init.deduplicated) {
        for (let i = 0; i < blocks; i++) {
          const form = new FormData();
          form.set('block', String(i + 1));
          form.set('file', blob(bytes.subarray(i * t.blockSize, (i + 1) * t.blockSize)), name);
          await env(await ous('/ous/api/v2/block/upload/part', { method: 'POST', body: form }));
        }
      }
    }
    // Status 5 is success per the OUS docs.
    for (let i = 0; i < 150; i++) {
      const s = await env<{ status: number; url?: string }>(await ous('/ous/api/v2/upload/status', { method: 'GET' }));
      if (s.status === 5 && s.url) return s.url;
      await this.o.sleep(1000);
    }
    throw new AholoError('UPLOAD_TIMEOUT', name);
  }

  textTo3dTurbo(prompt: string) {
    return this.luxTask('lux3d.text-to-3d.turbo', '/global/lux3d/v1/generate/text-to-3d/task/create', {
      prompt,
      version: 'G1-Turbo',
      outputFormat: ['glb'],
      aiPredictSize: true,
    });
  }

  /** Free call: check that the key works. */
  async ping(): Promise<boolean> {
    await this.lux('GET', '/global/lux3d/v1/generate/task/list');
    return true;
  }

  /**
   * Run one paid task with all the guards. `create` starts it and returns the task id,
   * `poll` returns null while running or the output URLs when done.
   */
  async spend(
    kind: CallKind,
    request: unknown,
    create: () => Promise<string>,
    poll: (taskId: string) => Promise<{ outputs: string[]; raw: unknown } | null>,
  ): Promise<TaskResult> {
    const key = cacheKey(kind, request);
    const hit = await this.o.cache.get(key);
    if (hit) {
      this.o.log(`cache hit for ${kind}, 0 credits`);
      return { ...hit, cached: true };
    }

    const balance = await this.o.ledger.balance();
    const decision = decideSpend({
      kind,
      balance,
      startingBalance: await this.o.ledger.startingBalance(),
      approvedUpTo: this.o.approvedUpTo,
    });
    if (!decision.ok) throw new AholoError('CREDIT_GUARD', decision.reason);

    this.o.log(`starting ${kind} (${decision.cost} credits)`);
    const taskId = await create();
    // Record the task before polling, so a crash mid-poll can resume instead of paying twice.
    await this.o.cache.pending(key, { kind, taskId, request });

    const started = Date.now();
    for (;;) {
      const r = await poll(taskId);
      if (r) {
        const result = { kind, taskId, outputs: r.outputs, raw: r.raw };
        await this.o.cache.put(key, result);
        await this.o.ledger.record({ kind, taskId, credits: COST[kind], request: summarise(request) });
        return { ...result, cached: false };
      }
      if (Date.now() - started > this.o.timeoutMs) throw new AholoError('TIMEOUT', `${kind} task ${taskId} still running`);
      await this.o.sleep(this.o.pollMs);
    }
  }

  async luxTask(kind: CallKind, path: string, body: Record<string, unknown>): Promise<TaskResult> {
    return this.spend(
      kind,
      { path, body },
      async () => String(await this.lux<number>('POST', path, body)),
      async (taskId) => {
        const d = await this.lux<{ status: number; outputs?: { content: string | null }[] }>(
          'GET',
          `/global/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(taskId)}`,
        );
        if (LUX_FAILED.has(d.status)) {
          throw new AholoError('TASK_FAILED', `${kind} task ${taskId}: ${d.outputs?.[0]?.content ?? 'no detail'}`);
        }
        if (d.status !== LUX_DONE) return null;
        const outputs = (d.outputs ?? []).map((o) => o.content ?? '').filter((u) => u && u !== 'NOT_REQUESTED');
        return { outputs, raw: d };
      },
    );
  }

  imgTo3dTurbo(imageUrl: string) {
    return this.luxTask('lux3d.img-to-3d.turbo', '/global/lux3d/v1/generate/img-to-3d/task/create', {
      img: imageUrl,
      version: 'G1-Turbo',
      outputFormat: ['glb'],
      aiPredictSize: true,
    });
  }

  imgTo3d(imageUrls: string[]) {
    return this.luxTask('lux3d.img-to-3d.g1', '/global/lux3d/v1/generate/img-to-3d/task/create', {
      imgs: imageUrls,
      version: 'G1',
      aiPredictSize: true,
    });
  }

  partSplit(glbUrl: string) {
    return this.luxTask('lux3d.part-split', '/global/lux3d/v1/part-split/task/create', { glbUrl });
  }

  articulate(glbUrl: string, prompt: string) {
    return this.luxTask('lux3d.articulation', '/global/lux3d/v1/articulation-animation/task/create', { glbUrl, prompt });
  }

  reconstruct(videoUrl: string, name: string, quality: 'low' | 'normal') {
    const kind: CallKind = quality === 'low' ? 'world.reconstruct.flash' : 'world.reconstruct.standard';
    return this.spend(
      kind,
      { videoUrl, quality },
      async () => {
        const r = await this.call<{ worldId: string }>('POST', '/global/world/v1/reconstructions', {
          name,
          resources: [{ url: videoUrl, type: 'video' }],
          taskQuality: quality,
          scene: 'space',
        });
        return r.worldId;
      },
      async (worldId) => {
        const w = await this.call<{ status: string; assets?: { splats?: { urls?: Record<string, string> } } }>(
          'GET',
          `/global/world/v1/${encodeURIComponent(worldId)}`,
        );
        if (w.status === 'FAILED' || w.status === 'CANCELLED') throw new AholoError('TASK_FAILED', `world ${worldId} ${w.status}`);
        if (w.status !== 'SUCCEEDED') return null;
        return { outputs: Object.values(w.assets?.splats?.urls ?? {}), raw: w };
      },
    );
  }
}

export function cacheKey(kind: string, request: unknown): string {
  return createHash('sha256').update(`${kind}\n${stableStringify(request)}`).digest('hex').slice(0, 24);
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Keep the ledger readable: shorten long URLs, never store keys. */
function summarise(request: unknown): string {
  return stableStringify(request).replace(/https?:\/\/[^"]+/g, (u) => (u.length > 60 ? `${u.slice(0, 57)}...` : u)).slice(0, 300);
}

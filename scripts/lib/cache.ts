// Disk cache for real API results. Result URLs expire after two hours, so `download()`
// copies each file into cache/files/ as soon as a task finishes.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CallKind } from '../../src/core/credits.ts';

export interface CachedResult {
  kind: CallKind;
  taskId: string;
  outputs: string[];
  raw: unknown;
}

export interface Cache {
  get(key: string): Promise<CachedResult | null>;
  put(key: string, value: CachedResult): Promise<void>;
  pending(key: string, value: { kind: CallKind; taskId: string; request: unknown }): Promise<void>;
}

export class DiskCache implements Cache {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private path(key: string) {
    return join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<CachedResult | null> {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8')) as CachedResult;
  }

  async put(key: string, value: CachedResult): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path(key)}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...value, savedAt: new Date().toISOString() }, null, 2));
    await rename(tmp, this.path(key));
  }

  async pending(key: string, value: { kind: CallKind; taskId: string; request: unknown }): Promise<void> {
    await mkdir(join(this.dir, 'pending'), { recursive: true });
    await writeFile(join(this.dir, 'pending', `${key}.json`), JSON.stringify({ ...value, at: new Date().toISOString() }, null, 2));
  }
}

export class MemoryCache implements Cache {
  readonly store = new Map<string, CachedResult>();
  readonly pendings: string[] = [];
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: CachedResult) {
    this.store.set(key, value);
  }
  async pending(key: string) {
    this.pendings.push(key);
  }
}

/** Download a result URL to cache/files/<name>. Skips the download if the file is already there. */
export async function download(url: string, dir: string, name: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  if (existsSync(p)) return p;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`download failed ${res.status} for ${name}`);
  await writeFile(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

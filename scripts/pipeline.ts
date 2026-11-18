// Offline pipeline: turns real inputs into the cached assets the site replays.
//
//   npm run pipeline -- ping
//   npm run pipeline -- balance
//   npm run pipeline -- object <id> --text "a ring of house keys"          (1 credit)
//   npm run pipeline -- object <id> --image path/to/photo.jpg               (1 credit)
//   npm run pipeline -- scan <roomId> --video rooms/raw/room1.mov [--quality low|normal] --approve 50
//   npm run pipeline -- piece <roomId> <containerId> --image frame.jpg [--image frame2.jpg]   (G1, up to 20)
//   npm run pipeline -- split <roomId> <containerId> --approve 30
//   npm run pipeline -- articulate <roomId> <containerId> --prompt "the top drawer slides out" --approve 28
//
// Every paid step checks the credit rule, then the cache. Results land in public/ for the site.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, extname } from 'node:path';
import { AholoClient, type TaskResult } from './lib/aholo.ts';
import { DiskCache, download } from './lib/cache.ts';
import { FileLedger } from './lib/ledger.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = join(ROOT, 'cache/files');

function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const p = join(ROOT, '.env.local');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2]!.replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

function args(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) (flags[a.slice(2)] ??= []).push(argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true');
    else pos.push(a);
  }
  return { pos, flag: (k: string) => flags[k]?.[0], flags: (k: string) => flags[k] ?? [] };
}

async function main() {
  const { pos, flag, flags } = args(process.argv.slice(2));
  const [cmd, ...rest] = pos;
  const ledger = new FileLedger(join(ROOT, 'data/ledger.json'));
  const client = new AholoClient({
    apiKey: env('AHOLO_API_KEY'),
    cache: new DiskCache(join(ROOT, 'cache')),
    ledger,
    approvedUpTo: Number(flag('approve') ?? 0),
    log: (m) => console.log(`  ${m}`),
  });

  const uploadLocal = async (p: string) => {
    const bytes = new Uint8Array(await readFile(p));
    console.log(`  uploading ${basename(p)} (${(bytes.byteLength / 1e6).toFixed(1)} MB)`);
    return client.upload(bytes, basename(p));
  };
  const save = async (r: TaskResult, dir: string, name: string, pick = (u: string) => /\.glb(\?|$)/i.test(u)) => {
    const url = r.outputs.find(pick) ?? r.outputs[0];
    if (!url) throw new Error(`task ${r.taskId} returned no files`);
    const ext = extname(new URL(url).pathname) || '.bin';
    const cached = await download(url, FILES, `${r.taskId}${ext}`);
    await mkdir(dir, { recursive: true });
    const out = join(dir, `${name}${ext}`);
    await copyFile(cached, out);
    return out;
  };
  const provenance = async (roomId: string, entry: Record<string, unknown>) => {
    const p = join(ROOT, 'public/rooms', roomId, 'provenance.json');
    const list = existsSync(p) ? (JSON.parse(await readFile(p, 'utf8')) as unknown[]) : [];
    list.push({ ...entry, date: new Date().toISOString().slice(0, 10) });
    await mkdir(join(ROOT, 'public/rooms', roomId), { recursive: true });
    await writeFile(p, `${JSON.stringify(list, null, 2)}\n`);
  };

  switch (cmd) {
    case 'ping':
      await client.ping();
      console.log('API key works.');
      break;
    case 'balance':
      console.log(`Ledger balance: ${await ledger.balance()} (starting ${await ledger.startingBalance()}). Check labs.aholo.ai/usage to reconcile.`);
      break;
    case 'object': {
      const [id] = rest;
      if (!id) throw new Error('usage: object <id> --text "..." | --image path');
      const text = flag('text');
      const image = flag('image');
      const r = text ? await client.textTo3dTurbo(text) : await client.imgTo3dTurbo(await uploadLocal(image!));
      const out = await save(r, join(ROOT, 'public/objects'), id);
      const idx = join(ROOT, 'public/objects/index.json');
      const list = existsSync(idx) ? (JSON.parse(await readFile(idx, 'utf8')) as Record<string, unknown>[]) : [];
      const entry = { id, label: flag('label') ?? id, file: `objects/${basename(out)}`, taskId: r.taskId, step: r.kind, input: text ? { text } : { image: basename(image!) } };
      await writeFile(idx, `${JSON.stringify([...list.filter((o) => o.id !== id), entry], null, 2)}\n`);
      console.log(`Saved ${out}${r.cached ? ' (from cache)' : ''}`);
      break;
    }
    case 'scan': {
      const [roomId] = rest;
      const video = flag('video');
      if (!roomId || !video) throw new Error('usage: scan <roomId> --video path');
      const quality = (flag('quality') ?? 'normal') as 'low' | 'normal';
      const r = await client.reconstruct(await uploadLocal(video), `stash-${roomId}`, quality);
      const dir = join(ROOT, 'public/rooms', roomId);
      for (const [i, url] of r.outputs.entries()) {
        const ext = extname(new URL(url).pathname) || '.bin';
        const f = await download(url, FILES, `${r.taskId}-${i}${ext}`);
        await mkdir(dir, { recursive: true });
        await copyFile(f, join(dir, `scan${ext}`));
      }
      await provenance(roomId, { step: r.kind, taskId: r.taskId, credits: r.cached ? 0 : undefined, artifact: 'scan' });
      console.log(`Scan saved in ${dir}`);
      break;
    }
    case 'piece':
    case 'split':
    case 'articulate': {
      const [roomId, containerId] = rest;
      if (!roomId || !containerId) throw new Error(`usage: ${cmd} <roomId> <containerId> ...`);
      const dir = join(ROOT, 'public/rooms', roomId, 'pieces');
      let r: TaskResult;
      let name: string;
      if (cmd === 'piece') {
        const urls = [];
        for (const p of flags('image')) urls.push(await uploadLocal(p));
        r = await client.imgTo3d(urls);
        name = `${containerId}.mesh`;
      } else {
        const src = join(dir, `${containerId}.${cmd === 'split' ? 'mesh' : 'parts'}.glb`);
        if (!existsSync(src)) throw new Error(`missing ${src}; run the previous step first`);
        const url = await uploadLocal(src);
        if (cmd === 'split') {
          r = await client.partSplit(url);
          name = `${containerId}.parts`;
        } else {
          const prompt = flag('prompt');
          if (!prompt) throw new Error('articulate needs --prompt "which part moves and how"');
          r = await client.articulate(url, prompt);
          name = `${containerId}.joint`;
        }
      }
      const out = await save(r, dir, name, () => true);
      await provenance(roomId, { step: r.kind, taskId: r.taskId, container: containerId, artifact: `pieces/${basename(out)}` });
      console.log(`Saved ${out}${r.cached ? ' (from cache)' : ''}`);
      break;
    }
    default:
      console.log('Commands: ping, balance, object, scan, piece, split, articulate. See the header of scripts/pipeline.ts.');
  }
  console.log(`Ledger balance now ${await ledger.balance()}.`);
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

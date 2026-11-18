import { describe, expect, it, vi } from 'vitest';
import { AholoClient, AholoError, cacheKey } from '../scripts/lib/aholo.ts';
import { MemoryCache } from '../scripts/lib/cache.ts';
import { MemoryLedger } from '../scripts/lib/ledger.ts';

// A fake Aholo API: tasks finish on the second poll. No test ever reaches the network.
function fakeApi(opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.aholo.ai', '')}`);
    if (url.includes('/task/create')) return json({ c: '0', m: '', d: 4242 });
    if (url.includes('/task/get')) {
      polls++;
      if (opts.fail) return json({ c: '0', d: { taskId: 4242, status: 4, outputs: [{ content: '{"error":"bad"}' }] } });
      if (polls < 2) return json({ c: '0', d: { taskId: 4242, status: 1 } });
      return json({ c: '0', d: { taskId: 4242, status: 3, outputs: [{ content: 'https://cdn/x.glb' }, { content: 'NOT_REQUESTED' }] } });
    }
    if (url.includes('/task/list')) return json({ c: '0', d: { items: [] } });
    return new Response('nope', { status: 404 });
  });
  return { fetch, calls };
}
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });

function client(over: Partial<ConstructorParameters<typeof AholoClient>[0]> = {}) {
  const api = fakeApi();
  const cache = new MemoryCache();
  const ledger = new MemoryLedger(3600);
  const c = new AholoClient({ apiKey: 'test', fetch: api.fetch, cache, ledger, sleep: async () => {}, ...over });
  return { c, api, cache, ledger };
}

describe('AholoClient', () => {
  it('runs a cheap task, drops NOT_REQUESTED outputs, caches it and records 1 credit', async () => {
    const { c, cache, ledger } = client();
    const r = await c.imgTo3dTurbo('https://img/a.jpg');
    expect(r.outputs).toEqual(['https://cdn/x.glb']);
    expect(r.cached).toBe(false);
    expect(cache.store.size).toBe(1);
    expect(cache.pendings).toHaveLength(1);
    expect(await ledger.balance()).toBe(3599);
  });

  it('serves the second identical request from cache, spending nothing and making no API call', async () => {
    const { c, api, ledger } = client();
    await c.imgTo3dTurbo('https://img/a.jpg');
    const before = api.fetch.mock.calls.length;
    const r = await c.imgTo3dTurbo('https://img/a.jpg');
    expect(r.cached).toBe(true);
    expect(api.fetch.mock.calls.length).toBe(before);
    expect(await ledger.balance()).toBe(3599);
  });

  it('refuses a 30-credit part-split without approval and never calls the API', async () => {
    const { c, api } = client();
    await expect(c.partSplit('https://cdn/x.glb')).rejects.toThrow(/needs approval/);
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('allows the part-split once approved', async () => {
    const { c, ledger } = client({ approvedUpTo: 30 });
    await c.partSplit('https://cdn/x.glb');
    expect(await ledger.balance()).toBe(3570);
  });

  it('refuses to dip into the reserve', async () => {
    const ledger = new MemoryLedger(3600);
    await ledger.record({ kind: 'test', credits: 2390 });
    const { c, api } = client({ ledger, approvedUpTo: 1000 });
    await expect(c.partSplit('https://cdn/x.glb')).rejects.toThrow(/reserve/);
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a failed task and charges nothing', async () => {
    const api = fakeApi({ fail: true });
    const ledger = new MemoryLedger(3600);
    const c = new AholoClient({ apiKey: 'k', fetch: api.fetch, cache: new MemoryCache(), ledger, sleep: async () => {} });
    await expect(c.imgTo3dTurbo('https://img/a.jpg')).rejects.toBeInstanceOf(AholoError);
    expect(await ledger.balance()).toBe(3600);
  });

  it('sends the key without a Bearer prefix', async () => {
    const { c, api } = client();
    await c.ping();
    const init = api.fetch.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('test');
  });

  it('cache keys ignore object key order', () => {
    expect(cacheKey('k', { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(cacheKey('k', { b: [1, { d: 3, c: 2 }], a: 1 }));
  });
});

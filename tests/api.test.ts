import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The live-generation endpoint with the Lux3D API faked. Proves the public site cannot
// spend credits past the caps.
function fakeLux(tasksToday: number) {
  const created: unknown[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/task/list')) return new Response(JSON.stringify({ c: '0', d: { total: tasksToday, items: [] } }));
    if (url.includes('/text-to-3d/task/create')) {
      created.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ c: '0', d: 777 }));
    }
    if (url.includes('/task/get')) return new Response(JSON.stringify({ c: '0', d: { status: 3, outputs: [{ content: 'https://cdn/x.glb' }] } }));
    return new Response('{}', { status: 404 });
  });
  return { fetch, created };
}

const post = (ip: string, prompt = 'a blue usb stick') =>
  new Request('https://site/api/generate', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ prompt }) });

describe('/api/generate', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AHOLO_API_KEY = 'test-key';
    process.env.LIVE_DAILY_CAP = '3';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses when the daily cap is reached and creates no task', async () => {
    const lux = fakeLux(3);
    vi.stubGlobal('fetch', lux.fetch);
    const { POST } = await import('../api/generate.ts');
    const r = await POST(post('1.1.1.1'));
    expect(r.status).toBe(429);
    expect(lux.created).toHaveLength(0);
  });

  it('allows one per visitor per 10 minutes, then refuses that visitor', async () => {
    const lux = fakeLux(0);
    vi.stubGlobal('fetch', lux.fetch);
    const { POST } = await import('../api/generate.ts');
    expect((await POST(post('2.2.2.2'))).status).toBe(200);
    expect((await POST(post('2.2.2.2'))).status).toBe(429);
    expect((await POST(post('3.3.3.3'))).status).toBe(200);
    expect(lux.created).toHaveLength(2);
  });

  it('is switched off with no key', async () => {
    delete process.env.AHOLO_API_KEY;
    const { POST } = await import('../api/generate.ts');
    expect((await POST(post('4.4.4.4'))).status).toBe(503);
  });

  it('rejects empty prompts and bad task ids without calling the API', async () => {
    const lux = fakeLux(0);
    vi.stubGlobal('fetch', lux.fetch);
    const { POST, GET } = await import('../api/generate.ts');
    expect((await POST(post('5.5.5.5', ' '))).status).toBe(400);
    expect((await GET(new Request('https://site/api/generate?taskId=abc'))).status).toBe(400);
    expect(lux.fetch).not.toHaveBeenCalled();
  });

  it('asks Lux3D for a small Turbo model, so each task costs the Turbo price', async () => {
    const lux = fakeLux(0);
    vi.stubGlobal('fetch', lux.fetch);
    const { POST } = await import('../api/generate.ts');
    await POST(post('6.6.6.6'));
    expect(lux.created[0]).toMatchObject({ version: 'G1-Turbo', faceCount: 20000 });
  });
});

// Minimal Lux3D calls for the serverless functions. The key comes from the server's
// environment and never reaches the browser.

export const API = 'https://api.aholo.ai';

export function key(): string {
  return process.env.AHOLO_API_KEY ?? '';
}

export async function lux<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: key(), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { c?: string; m?: string; d?: T };
  if (j.c !== '0') throw new Error(j.m || `Lux3D error ${j.c ?? r.status}`);
  return j.d as T;
}

/** Tasks created on this account since UTC midnight (free call). Used for the daily cap. */
export async function tasksToday(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const d = await lux<{ total: number }>(`/global/lux3d/v1/generate/task/list?page=1&pagesize=1&starttime=${start.getTime()}`);
  return d.total;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// POST { prompt } starts one Lux3D Turbo text-to-3D task (13 credits) and returns its id.
// GET ?taskId= checks it (free). A daily cap protects the credit reserve; when the cap is
// reached or anything fails, the client falls back to the ready-made objects.

import { json, key, lux, tasksToday } from './_lux.js';

const DAILY_CAP = Number(process.env.LIVE_DAILY_CAP ?? 3);

export async function POST(request: Request): Promise<Response> {
  if (!key()) return json({ ok: false, reason: 'live generation is switched off' }, 503);
  let prompt = '';
  try {
    prompt = String(((await request.json()) as { prompt?: unknown }).prompt ?? '')
      .replace(/[\u0000-\u001f]/g, ' ')
      .trim()
      .slice(0, 80);
  } catch {
    /* handled below */
  }
  if (prompt.length < 2) return json({ ok: false, reason: 'type a short object name' }, 400);
  try {
    if ((await tasksToday()) >= DAILY_CAP) return json({ ok: false, reason: "today's live limit is reached" }, 429);
    const taskId = await lux<number>('/global/lux3d/v1/generate/text-to-3d/task/create', {
      method: 'POST',
      body: JSON.stringify({
        prompt: `${prompt}, a single small household object, plain background`,
        version: 'G1-Turbo',
        outputFormat: ['glb'],
        faceCount: 20000,
        aiPredictSize: true,
      }),
    });
    return json({ ok: true, taskId: String(taskId) });
  } catch (e) {
    return json({ ok: false, reason: (e as Error).message.slice(0, 120) }, 502);
  }
}

export async function GET(request: Request): Promise<Response> {
  const taskId = new URL(request.url).searchParams.get('taskId') ?? '';
  if (!/^\d{1,15}$/.test(taskId)) return json({ ok: false, reason: 'bad task id' }, 400);
  try {
    const d = await lux<{ status: number; outputs?: { content: string | null }[] }>(
      `/global/lux3d/v1/generate/task/get?taskid=${taskId}`,
    );
    if (d.status === 3) {
      const glbUrl = (d.outputs ?? []).map((o) => o.content ?? '').find((u) => /^https:\/\//.test(u));
      return json({ ok: true, done: true, taskId, glbUrl });
    }
    if (d.status === 4 || d.status === 6) return json({ ok: false, done: true, reason: 'generation failed' });
    return json({ ok: true, done: false, taskId });
  } catch (e) {
    return json({ ok: false, reason: (e as Error).message.slice(0, 120) }, 502);
  }
}

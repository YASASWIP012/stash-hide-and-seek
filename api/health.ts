// Health check: is the site built, is the Lux3D key configured and reachable, how much of
// today's live-generation cap is used. All checks are free API calls.

import { json, key, tasksToday } from './_lux.js';

export async function GET(): Promise<Response> {
  const started = Date.now();
  const out: Record<string, unknown> = {
    ok: true,
    service: 'stash',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    judgesPath: 'replays saved results; works without the API',
    liveGeneration: key() ? 'configured' : 'off',
  };
  if (key()) {
    try {
      out.lux3dReachable = true;
      out.liveTasksToday = await tasksToday();
      out.liveDailyCap = Number(process.env.LIVE_DAILY_CAP ?? 3);
    } catch (e) {
      out.lux3dReachable = false;
      out.lux3dError = (e as Error).message.slice(0, 120);
    }
  }
  out.ms = Date.now() - started;
  return json(out);
}

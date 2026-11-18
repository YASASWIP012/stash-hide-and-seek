# Stash

Hide something in a real room, then watch a robot search for it, one drawer or door at a time. Send the hide to a friend and see who finds it faster.

Live demo: https://stash-hide-and-seek.vercel.app (no account needed; Chinese at `?lang=zh`). Project report: https://stash-hide-and-seek.vercel.app/Stash-report.pdf. Status: https://stash-hide-and-seek.vercel.app/api/health

## How it works

| Step | Tool | Status |
|---|---|---|
| Phone video to 3D room | Aholo Reality (3D Gaussian splat) | Waiting for the first room video |
| Find the furniture | Aholo Spatial Understanding | Planned |
| Make each piece of furniture | Lux3D, with size prediction | Done for the demo room |
| Separate drawers and doors | Lux3D part split | Next |
| Add joints | Lux3D articulation | Next |
| Render and play | Aholo Viewer | Done |
| Robot export | URDF from the same joints | Done |

The demo room is a placeholder laid out by hand. Its furniture is real Lux3D output, and the task ids are listed on the page. Its moving parts are boxes with estimated joint limits until part split and articulation run.

The robot is a simulated agent with a stated rule: open the spot with the best chance per second of effort, then rule it out. Its odds start from container size and type and shift with logged hides.

## Reliability

- The game replays saved results, so judging never depends on the API.
- If WebGL is unavailable or a model fails to load, the room falls back to a 2D floor plan that plays the same way.
- Live generation is optional, capped per day, and falls back to the ready-made objects.
- `/api/health` reports whether the API key is set and reachable.

The report is built from `report/report.html`: `node --experimental-strip-types report/capture.ts all` takes the screenshots from the live site, and `node --experimental-strip-types report/build.ts` prints the PDF.

## Run locally

```bash
npm ci
npm run dev
```

```bash
npm run check
```

The offline pipeline (`scripts/pipeline.ts`) makes the saved results. It reads `AHOLO_API_KEY` from `.env.local` and checks a credit guard before every paid call: calls over 20 credits need `--approve`, and a third of the balance is never spent. It caches every result to disk and records each spend in `data/ledger.json`. Tests mock the API and never spend credits.

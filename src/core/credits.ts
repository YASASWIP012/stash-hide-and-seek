// Credit costs and the spending rule. Prices from https://labs.aholo.ai/pricing (read 18 Nov 2026).
// Credits are only deducted when a task succeeds, but we budget as if every call succeeds.

export type CallKind =
  | 'lux3d.img-to-3d.turbo'
  | 'lux3d.img-to-3d.g1'
  | 'lux3d.text-to-3d.turbo'
  | 'lux3d.part-split'
  | 'lux3d.articulation'
  | 'lux3d.export'
  | 'lux3d.four-view'
  | 'world.reconstruct.flash'
  | 'world.reconstruct.standard'
  | 'world.generate'
  | 'spatial.understanding'
  | 'free';

export const COST: Record<CallKind, number> = {
  'lux3d.img-to-3d.turbo': 1,
  'lux3d.img-to-3d.g1': 20, // budget at the Pro price until the first real call confirms which tier G1 bills as
  'lux3d.text-to-3d.turbo': 13, // verified 18 Nov: usage page billed 13 per task (text to image, then image to mesh)
  'lux3d.part-split': 30,
  'lux3d.articulation': 28,
  'lux3d.export': 1,
  'lux3d.four-view': 12,
  'world.reconstruct.flash': 20,
  'world.reconstruct.standard': 50,
  'world.generate': 10,
  'spatial.understanding': 1000,
  free: 0,
};

/** Runs above this need the owner's explicit approval for that exact amount. */
export const APPROVAL_THRESHOLD = 20;
/** Fraction of the starting balance that is never spent by the pipeline. */
export const RESERVE_FRACTION = 1 / 3;

export interface SpendRequest {
  kind: CallKind;
  balance: number; // current balance
  startingBalance: number; // balance the reserve is computed from
  approvedUpTo?: number; // credits the owner approved for this run
}

export type SpendDecision = { ok: true; cost: number } | { ok: false; cost: number; reason: string };

export function decideSpend(r: SpendRequest): SpendDecision {
  const cost = COST[r.kind];
  if (cost === 0) return { ok: true, cost };
  const reserve = Math.ceil(r.startingBalance * RESERVE_FRACTION);
  if (r.balance - cost < reserve) {
    return { ok: false, cost, reason: `would leave ${r.balance - cost}, below the ${reserve}-credit reserve` };
  }
  if (cost > APPROVAL_THRESHOLD && (r.approvedUpTo ?? 0) < cost) {
    return { ok: false, cost, reason: `costs ${cost} credits; needs approval (pass --approve ${cost})` };
  }
  return { ok: true, cost };
}

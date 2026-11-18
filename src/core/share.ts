// A hide is shared as a URL fragment, so no server or account is needed.

export interface SharedHide {
  v: 1;
  room: string;
  container: string;
  object: string; // id of the hidden object (preset or generated)
  hiderTime?: number; // seconds the robot needed, shown to the friend as the time to beat
}

const enc = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const dec = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(b, (ch) => ch.charCodeAt(0)));
};

/** Small checksum so a mistyped link fails loudly instead of loading the wrong hide. */
function check(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).slice(0, 4);
}

export function encodeHide(h: SharedHide): string {
  const body = enc(JSON.stringify(h));
  return `${body}.${check(body)}`;
}

export function decodeHide(token: string): SharedHide | null {
  const [body, sum] = token.split('.');
  if (!body || !sum || check(body) !== sum) return null;
  try {
    const h = JSON.parse(dec(body)) as Partial<SharedHide>;
    if (h.v !== 1 || typeof h.room !== 'string' || typeof h.container !== 'string' || typeof h.object !== 'string') {
      return null;
    }
    return h as SharedHide;
  } catch {
    return null;
  }
}

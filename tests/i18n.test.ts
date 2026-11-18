import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectLang, MESSAGES, ZH_ATTR, ZH_HTML } from '../src/i18n.ts';
import { planSearch } from '../src/core/search.ts';
import { sampleReplay } from '../src/core/timeline.ts';
import type { RoomManifest } from '../src/core/types.ts';

const html = readFileSync('index.html', 'utf8');
const room = JSON.parse(readFileSync('public/rooms/demo/room.json', 'utf8')) as RoomManifest;
const objects = JSON.parse(readFileSync('public/objects/index.json', 'utf8')) as { label: string }[];

describe('language choice', () => {
  it('?lang= wins over the saved choice and the browser', () => {
    expect(detectLang('?lang=zh', 'en', ['en-US'])).toBe('zh');
    expect(detectLang('?lang=en', 'zh', ['zh-CN'])).toBe('en');
  });
  it('falls back to the saved choice, then the browser language', () => {
    expect(detectLang('', 'zh', ['en-US'])).toBe('zh');
    expect(detectLang('', null, ['zh-TW'])).toBe('zh');
    expect(detectLang('', null, ['en-GB', 'fr'])).toBe('en');
    expect(detectLang('?lang=xx', 'nope', [])).toBe('en');
  });
});

describe('Chinese coverage', () => {
  it('every tagged element in the page has a Chinese string', () => {
    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(ZH_HTML[k], k).toBeTruthy();
    for (const m of html.matchAll(/data-i18n-(?:aria|ph)="([^"]+)"/g)) expect(ZH_ATTR[m[1]!], m[1]).toBeTruthy();
  });
  it('every room and object label has a Chinese name', () => {
    const zh = MESSAGES.zh.label;
    for (const l of [...room.containers, ...room.fixtures, ...objects].map((x) => x.label)) expect(zh(l), l).not.toBe(l);
  });
  it('no dashes used as punctuation in either language', () => {
    const all = JSON.stringify({ ZH_HTML, ZH_ATTR }) + html;
    expect(all).not.toMatch(/[—–]|——/);
  });
});

describe('robot voice', () => {
  it('speaks Chinese when asked and keeps English as the default', () => {
    const run = planSearch(room, [], room.containers[0]!.id);
    const labels = Object.fromEntries(room.containers.map((c) => [c.id, MESSAGES.zh.label(c.label)]));
    const first = sampleReplay(run.events, 0, room.spawn, labels, MESSAGES.zh.voice);
    expect(first.say).toMatch(/可能性 \d+%/);
    const last = sampleReplay(run.events, run.foundAt! + 0.01, room.spawn, labels, MESSAGES.zh.voice);
    expect(last.say).toBe('找到了。');
    expect(sampleReplay(run.events, 0, room.spawn, {}).say).toMatch(/likely$/);
  });
});

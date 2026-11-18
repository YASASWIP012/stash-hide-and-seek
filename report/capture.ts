// Takes the report screenshots from the live site. Run: node --experimental-strip-types report/capture.ts [step]
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://stash-hide-and-seek.vercel.app';
const out = (n: string) => `report/shots/${n}.jpg`;
const step = process.argv[2] ?? 'probe';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'en-US' });
page.on('pageerror', (e) => console.log('pageerror', e.message));

if (step === 'probe') {
  await page.goto(`${BASE}/#play`);
  await page.waitForFunction(() => document.querySelector('#renderer')?.textContent !== 'Loading', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const box = await page.locator('#stage').boundingBox();
  console.log('stage', JSON.stringify(box), await page.locator('#renderer').textContent());
  await page.locator('#stage').screenshot({ path: out('probe'), quality: 70, type: 'jpeg' });
}

const ready = async () => {
  await page.waitForFunction(() => document.querySelector('#renderer')?.textContent !== 'Loading', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
};
const win = () => page.locator('#play .window');
const shot = (name: string, loc = win()) => loc.screenshot({ path: out(name), quality: 78, type: 'jpeg' });

if (step === 'all') {
  // 1. Landing view
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out('01-hero'), quality: 78, type: 'jpeg' });

  // 2-4. Hide, robot search, result (3D)
  await page.goto(`${BASE}/#play`);
  await ready();
  await shot('02-hide');
  await page.locator('#stage').click({ position: { x: 585, y: 275 } }); // nightstand drawer
  await page.waitForTimeout(1000);
  await shot('03-hidden');
  await page.waitForTimeout(2600);
  await shot('04-robot-early');
  await page.waitForTimeout(2600);
  await shot('05-robot-late');
  await page.locator('#result').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(400);
  await shot('06-result');
  const link = await page.locator('#share-url').inputValue();
  console.log('robot result:', await page.locator('#result-title').textContent(), '|', await page.locator('#result-body').textContent());

  // 5. A scripted seeker opens the shared link (this is a test run, not a real player)
  await page.goto(link);
  await ready();
  await shot('07-seek');
  await page.locator('#stage').click({ position: { x: 395, y: 220 } }); // dresser top drawer: wrong
  await page.waitForTimeout(1200);
  await page.locator('#stage').click({ position: { x: 585, y: 275 } });
  await page.locator('#result').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await shot('08-seek-done');
  console.log('seek result:', await page.locator('#result-title').textContent(), '|', await page.locator('#result-body').textContent());

  // 6. Chinese
  await page.goto(`${BASE}/?lang=zh#play`);
  await ready();
  await page.locator('#stage').click({ position: { x: 585, y: 275 } });
  await page.waitForTimeout(4200);
  await shot('09-zh-robot');

  // 7. Floor plan fallback
  await page.goto(`${BASE}/?plan=1&lang=en#play`);
  await page.waitForTimeout(1500);
  await shot('10-plan');

  // 8. How it is made + export
  await page.goto(`${BASE}/?lang=en#how`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
  await page.waitForTimeout(800);
  await shot('11-how', page.locator('#how'));
  await shot('12-export', page.locator('#export'));
}
if (step === 'dresser') {
  // Close-up of a Lux3D drawer on its Lux3D joint, pulled out
  await page.goto(`${BASE}/?lang=en#play`);
  await ready();
  await page.locator('#stage').click({ position: { x: 395, y: 212 } }); // dresser top drawer
  await page.waitForTimeout(700);
  const b = (await page.locator('#stage').boundingBox())!;
  await page.screenshot({ path: out('13-dresser-open'), quality: 85, type: 'jpeg', clip: { x: b.x + 230, y: b.y + 120, width: 330, height: 220 } });
  await page.waitForTimeout(400);
}
if (step === 'wardrobe') {
  // Both Lux3D wardrobe doors open on their Lux3D hinges
  await page.goto(`${BASE}/?lang=en#play`);
  await ready();
  await page.locator('#stage').click({ position: { x: 180, y: 240 } });
  await page.waitForTimeout(250);
  const b = (await page.locator('#stage').boundingBox())!;
  await page.screenshot({ path: out('14-wardrobe-open'), quality: 85, type: 'jpeg', clip: { x: b.x, y: b.y + 60, width: 360, height: 360 } });
}
if (step === 'plan') {
  await page.goto(`${BASE}/?plan=1&lang=en#play`);
  await page.waitForTimeout(1500);
  await shot('10-plan');
}
await browser.close();

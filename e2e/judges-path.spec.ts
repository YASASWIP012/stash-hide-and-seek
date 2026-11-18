import { expect, test } from '@playwright/test';

// The judges' path: open the page, hide the object, watch the robot, get a share link,
// open the link as a friend and find it. Runs on the floor plan (?plan=1) so it is
// deterministic on machines without a GPU, then checks the 3D stage separately.

test('hide, robot search, share, friend finds it', async ({ page }) => {
  await page.goto('/?plan=1#play');
  await expect(page.locator('#instructions')).toContainText('Pick an object');
  await page.getByRole('button', { name: 'Open Nightstand drawer' }).click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#result-title')).toContainText(/robot/i);
  const link = await page.locator('#share-url').inputValue();
  expect(link).toContain('#h=');

  await page.goto(link.replace(/^https?:\/\/[^/]+/, '').replace('?room=demo', '?room=demo&plan=1'));
  await expect(page.locator('#instructions')).toContainText('Your friend hid something');
  // Mouse on a stacked drawer (they used to cover each other in the plan), then the keyboard.
  await page.getByRole('button', { name: 'Open Dresser, top drawer' }).click();
  await page.getByRole('button', { name: 'Open Nightstand drawer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result-title')).toContainText('You found it');
});

test('a broken share link falls back to a fresh round', async ({ page }) => {
  await page.goto('/?plan=1#h=garbage.abcd');
  await expect(page.locator('#instructions')).toContainText('Pick an object');
});

test('3D stage loads Lux3D models without console errors', async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#play');
  await expect(page.locator('#renderer')).not.toHaveText('Loading', { timeout: 30_000 });
  const renderer = await page.locator('#renderer').textContent();
  test.info().annotations.push({ type: 'renderer', description: `${browserName}: ${renderer}` });
  expect(errors).toEqual([]);
});

test('URDF download is well formed', async ({ page }) => {
  await page.goto('/?plan=1');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#urdf-btn').click()]);
  const xml = await (await dl.createReadStream())?.toArray();
  const text = Buffer.concat(xml as Buffer[]).toString('utf8');
  expect(text).toContain('<robot name="demo">');
  expect(text.match(/type="(prismatic|revolute)"/g)?.length).toBe(6);
});

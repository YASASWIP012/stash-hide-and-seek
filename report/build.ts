// Prints report/report.html to public/Stash-report.pdf, plus page previews for checking.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1123, height: 794 } });
await page.goto(pathToFileURL(resolve('report/report.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: 'public/Stash-report.pdf', format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
if (process.argv[2] === 'preview') {
  const n = await page.locator('.page').count();
  for (let i = 0; i < n; i++) await page.locator('.page').nth(i).screenshot({ path: `report/preview-${i + 1}.png` });
  // flag any page whose content runs past its bottom edge
  const over = await page.$$eval('.page', (ps) => ps.map((p, i) => [i + 1, p.scrollHeight - p.clientHeight]).filter(([, d]) => (d as number) > 0));
  console.log('overflow', JSON.stringify(over));
}
await browser.close();

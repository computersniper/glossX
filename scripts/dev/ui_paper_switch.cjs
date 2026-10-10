// Switching papers must replace the PDF in the center, not only the tab title.
// Run against ui_browser_server.py; uses an existing PLAYWRIGHT_MODULE and BROWSER_PATH.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.argv[2] || 'http://127.0.0.1:8798';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const titles = ['Switch test paper one', 'Switch test paper two'];
    for (const title of titles) {
      const pdf = await context.request.get(`${base}/ui-acceptance.pdf?title=${encodeURIComponent(title)}`);
      const r = await context.request.post(base + '/api/papers/upload', { multipart: { file: { name: `${title}.pdf`, mimeType: 'application/pdf', buffer: await pdf.body() } } });
      assert.ok(r.ok());
    }
    await context.addInitScript(() => {
      localStorage.setItem('gloss.mode', 'glossx'); localStorage.setItem('gloss.uiLang', 'en');
      localStorage.setItem('gloss.layout', JSON.stringify({ sideOpen: true, activity: 'library', aiOpen: false, bottomOpen: false }));
    });
    const page = await context.newPage();
    await page.goto(base);
    for (let i = 0; i < 6; i++) {
      const title = titles[i % 2];
      await page.locator('.wb-side-body').getByText(title).first().click();
      await page.locator('.textLayer').first().filter({ hasText: title }).waitFor({ timeout: 10000 });
    }
    console.log('PASS paper switches always replace the PDF');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });

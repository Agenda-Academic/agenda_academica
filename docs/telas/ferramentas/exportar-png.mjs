// Exporta cada tela (elemento .screen) de figma-export.html como PNG em alta resolução.
// Uso: node ferramentas/exportar-png.mjs figma-export.html png
// Requer o Playwright. Por padrão procura o pacote a partir desta pasta; PLAYWRIGHT_DE aponta para o
// package.json de outro projeto que já o tenha, e CHROMIUM_PATH para um navegador específico.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_DE || import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('@playwright/test');
}
const { chromium } = playwright;

const [, , htmlArg = 'figma-export.html', outArg = 'png'] = process.argv;
const html = resolve(htmlArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const screens = await page.$$('.screen');
let i = 0;
for (const el of screens) {
  i += 1;
  const name = (await el.getAttribute('data-name')) || `tela-${i}`;
  const file = `${String(i).padStart(2, '0')} - ${name.replace(/·/g, '-').replace(/[\\/:*?"<>|×]/g, 'x').replace(/\s+/g, ' ').trim()}.png`;
  await el.screenshot({ path: join(out, file) });
  console.log('ok', file);
}
await browser.close();

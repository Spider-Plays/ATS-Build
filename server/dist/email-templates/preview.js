/**
 * Renders every email with sample data so designs can be reviewed in a browser.
 *   npm run email:preview   →   open server/.cache/email-preview/index.html
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineBrandImagesAsDataUris } from './assets.js';
import { samples } from './samples.js';
const outDir = join(process.cwd(), '.cache', 'email-preview');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const sample of samples) {
    writeFileSync(join(outDir, `${sample.id}.html`), inlineBrandImagesAsDataUris(sample.email.html));
}
const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const groups = ['Candidate', 'Vendor', 'Referral', 'Staff', 'Workflow'];
const nav = groups
    .map((group) => `<h2>${group}</h2>${samples
    .filter((s) => s.group === group)
    .map((s) => `<button data-file="${s.id}.html" data-subject="${esc(s.email.subject)}">${esc(s.name)}</button>`)
    .join('')}`)
    .join('');
writeFileSync(join(outDir, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Stitch email preview</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet" />
<style>
  body { margin: 0; display: grid; grid-template-columns: 280px 1fr; height: 100vh; font-family: 'Plus Jakarta Sans', 'Segoe UI', sans-serif; background: #F5F7F9; color: #15181E; }
  nav { overflow: auto; padding: 20px 16px; border-right: 1px solid #E4E8EE; background: #fff; }
  nav h1 { font-size: 16px; margin: 0 0 4px; } nav p { margin: 0 0 12px; font-size: 12px; color: #6F7785; }
  h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6F7785; margin: 18px 0 6px; }
  nav button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 7px 10px; border-radius: 8px; font: inherit; font-size: 13.5px; font-weight: 600; color: #4E545F; cursor: pointer; }
  nav button:hover { background: #F2F4F8; } nav button[aria-current="true"] { background: #E2EEFD; color: #0B2D5C; }
  main { display: flex; flex-direction: column; min-width: 0; }
  header { display: flex; gap: 12px; align-items: center; padding: 12px 20px; border-bottom: 1px solid #E4E8EE; background: #fff; }
  header b { flex: 1; font-size: 14px; } header button { border: 1px solid #CBCFD7; background: #fff; border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
  header button[aria-pressed="true"] { background: #1452A3; border-color: #1452A3; color: #fff; }
  .stage { flex: 1; overflow: auto; display: flex; justify-content: center; padding: 20px; }
  iframe { border: 1px solid #E4E8EE; border-radius: 12px; background: #fff; width: 680px; height: 100%; min-height: 900px; }
</style></head>
<body>
<nav><h1>Stitch ATS emails</h1><p>${samples.length} emails · generated ${new Date().toLocaleString()}</p>${nav}</nav>
<main><header><b id="subject"></b><button data-w="680" aria-pressed="true">Desktop</button><button data-w="390">Mobile</button></header>
<div class="stage"><iframe id="frame" title="Email preview"></iframe></div></main>
<script>
  const frame = document.getElementById('frame')
  const pick = (btn) => {
    document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-current', String(b === btn)))
    frame.src = btn.dataset.file
    document.getElementById('subject').textContent = btn.dataset.subject
  }
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => pick(b)))
  document.querySelectorAll('header button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('header button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    frame.style.width = b.dataset.w + 'px'
  }))
  pick(document.querySelector('nav button'))
</script>
</body></html>
`);
console.log(`Wrote ${samples.length} email previews to ${join(outDir, 'index.html')}`);
process.exit(0);

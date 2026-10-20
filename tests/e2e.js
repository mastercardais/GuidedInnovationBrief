/* End-to-end: walks a real brief through every screen against the running server and the real
   models, screenshotting each screen. Costs a few cents of API calls and about two minutes.

     node scripts/e2e.js                 typed path, desktop
     node scripts/e2e.js --voice         the "Talk it through" call, with a synthetic client on the mic
     node scripts/e2e.js --size 390x844  phone
     node scripts/e2e.js --out /tmp/shots

   Needs the server running (npm start) and Google Chrome installed. */
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:3000');
const OUT = opt('--out', join(HERE, '..', 'data', 'e2e'));
const [W, H] = opt('--size', '1440x900').split('x').map(Number);
const VOICE = argv.includes('--voice');
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let shotN = 0;
const t0 = Date.now();

const brief = await (await fetch(`${BASE}/api/console/briefs`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client: 'Wattlebird Bank', contact: 'Dana Whitlock', role: 'Head of Member Growth' }) })).json();
log('brief', brief.id);

const page = await launch({ width: W, height: H, micWav: VOICE ? join(HERE, 'fixtures', 'client.wav') : null });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 2200)); const p = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`); await page.shot(p); log('shot', p); };
const screen = () => page.eval(() => { const v = document.querySelector('.view'); return v ? `${v.dataset.b}-${v.dataset.s}` : null; });
const onScreen = (b, s = 0) => page.until((b, s) => { const v = document.querySelector('.view'); return v && v.dataset.b === b && v.dataset.s === String(s) && !document.body.classList.contains('thinking'); }, { label: `${b}-${s}`, timeout: 20000 }, b, s);
const settled = (timeout = 90000) => page.until(() => !document.querySelector('.genwait') && !document.querySelector('.generr'), { label: 'generation', timeout });
const click = (sel, text) => page.eval((sel, text) => {
  const els = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.trim().includes(text));
  const el = els.find((e) => !e.disabled && e.offsetParent !== null) || els[0];
  if (!el) throw new Error(`no ${sel} ${text || ''}`);
  el.click(); return true;
}, sel, text);
const nextBtn = () => click('[data-next]');
const failIfError = async () => { const e = await page.eval(() => document.querySelector('.generr')?.innerText); if (e) throw new Error(`screen shows an error: ${e}`); };

try {
  await page.goto(`${BASE}/b/${brief.id}`);
  await onScreen('welcome'); await page.until(() => document.getElementById('clientName').textContent, { label: 'boot' });
  await shot('welcome'); await nextBtn();

  // Documents: upload the fixture PDF, read it, check findings came back.
  await onScreen('docs'); await click('[data-yes]');
  await page.setFiles('.drop input[type=file]', [join(HERE, 'fixtures', 'Wattlebird Strategy 2026.pdf')]);
  await page.until(() => document.querySelector('.file') && !document.querySelector('.file.up'), { label: 'upload' });
  await shot('docs-upload'); await nextBtn();
  await onScreen('docs', 1); await page.until(() => document.querySelectorAll('.line[data-i]').length >= 3, { label: 'findings', timeout: 120000 });
  log('findings:', await page.eval(() => [...document.querySelectorAll('.line .lt')].map((e) => e.textContent)));
  await shot('docs-findings'); await nextBtn();

  // The messy version.
  await onScreen('dump');
  if (VOICE) {
    await click('[data-m="1"]');
    await page.until(() => document.querySelector('.lchip')?.dataset.s === 'listen' || document.querySelector('.lchip')?.dataset.s === 'speak' || document.querySelector('.lchip')?.dataset.s === 'err', { label: 'call connected', timeout: 30000 });
    const s = await page.eval(() => document.querySelector('.lchip').dataset.s);
    if (s === 'err') throw new Error('call failed: ' + await page.eval(() => document.querySelector('.lchip').innerText));
    log('call connected');
    await page.until(() => document.querySelectorAll('.lmsg.ai:not(.lwait)').length >= 1, { label: 'AI greeting', timeout: 30000 });
    // Wait for the greeting to finish (no new AI words for 2.5s), then the synthetic client speaks.
    await page.until(async () => { const t = document.querySelector('.lmsg.ai:not(.lwait)')?.textContent; await new Promise((r) => setTimeout(r, 2500)); return t && t === document.querySelector('.lmsg.ai:not(.lwait)')?.textContent; }, { label: 'greeting finished', timeout: 40000 });
    await shot('call-greeting');
    await page.eval(() => window.__micGo());
    await page.until(() => document.querySelectorAll('.lmsg.me').length >= 1 && document.querySelectorAll('.lmsg.ai:not(.lwait)').length >= 2, { label: 'a full exchange', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 6000));
    log('transcript:', await page.eval(() => [...document.querySelectorAll('.lmsg:not(.lwait)')].map((e) => `${e.classList.contains('ai') ? 'AI' : 'CLIENT'}: ${e.textContent}`)));
    await shot('call-exchange');
    await click('[data-end]');
  } else {
    await page.eval(() => {
      const f = document.querySelector('.composer .field');
      f.textContent = 'Our members are getting older. Kids join through mum and dad, and by twenty-five most have moved to an app bank. The board keeps saying we need an app for young people, but honestly I am not sure an app is the answer. Our app is fine. Scam losses are up and older members are rattled. New CEO wants a direction by March.';
      f.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await shot('dump'); await nextBtn();
  }

  // Customer, outcomes, confidence x3.
  await onScreen('cust'); await settled(); await failIfError();
  log('customer:', await page.eval(() => document.querySelector('.onecard .ot').textContent));
  await shot('cust');
  await click('.onecard [data-rg]'); await page.until(() => !document.querySelector('.regening'), { label: 'regen customer' });
  log('customer (regenerated):', await page.eval(() => document.querySelector('.onecard .ot').textContent));
  await nextBtn();
  await onScreen('custout'); await settled(); await click('.line [data-tick]'); await shot('custout'); await nextBtn();
  await onScreen('confintro'); await shot('confintro'); await nextBtn();
  for (let s = 0; s < 3; s++) {
    await onScreen('conf', s); await settled();
    log(`claim ${s + 1}:`, await page.eval(() => document.querySelector('.q .qt').innerText));
    await page.eval((v) => { const t = document.querySelector('.track'); const r = t.getBoundingClientRect(); const x = r.left + 32 + (r.width - 64) * v; t.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, pointerId: 1, bubbles: true })); t.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })); }, [0.15, 0.55, 0.9][s]);
    await shot(`conf-${s + 1}`);
    await nextBtn();
  }

  // HMW, winning, story, worth, concerns.
  await onScreen('hmw'); await settled(); await failIfError();
  log('hmw:', await page.eval(() => [...document.querySelectorAll('.ocard .ot')].map((e) => e.textContent)));
  await click('.ocard .opick'); await shot('hmw'); await nextBtn();
  await onScreen('win'); await settled();
  // Pick three by their circles (they used to ignore clicks), then Next must refuse and nudge the first pick's flag.
  await page.eval(() => { const n = [...document.querySelectorAll('.pill[data-i] .n')]; n[0].click(); n[2].click(); n[3].click(); });
  if (await page.eval(() => document.querySelectorAll('.pill.on').length) !== 3) throw new Error('win: circles did not pick');
  if (!await page.eval(() => document.querySelector('.pill[data-i="0"] .tipw.ask')?.textContent === 'Select your highest priority')) throw new Error('win: no priority nudge at three picks');
  await shot('win-nudge');
  await nextBtn(); await new Promise((r) => setTimeout(r, 800));
  if (await screen() !== 'win-0') throw new Error('win: Next moved on without a priority');
  await page.eval(() => { document.querySelector('.pill[data-i="3"] .pick').click(); document.querySelector('.pill[data-i="0"] [data-mk]').click(); });
  if (await page.eval(() => !!document.querySelector('.tipw.ask, .markb.nudge'))) throw new Error('win: nudge stayed after marking');
  await click('.pill[data-i="4"] [data-rg]'); await page.until(() => !document.querySelector('.regening'), { label: 'regen pill' });
  await shot('win'); await nextBtn();
  await onScreen('pressintro');
  log('story button while writing:', await page.eval(() => document.querySelector('[data-next]').textContent));
  await shot('pressintro');
  await page.until(() => !document.querySelector('[data-next]').disabled, { label: 'story written', timeout: 120000 }); await nextBtn();
  await onScreen('press'); await settled();
  log('story:', await page.eval(() => document.querySelector('.clip h2').textContent));
  await page.until(() => document.querySelector('.clip .photo').style.backgroundImage.includes('/img/'), { label: 'press photo', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200)); await shot('press'); await nextBtn();
  await onScreen('worth'); await click('[data-w="1"]'); await shot('worth'); await nextBtn();
  await onScreen('concerns'); await settled();
  await page.eval(() => { const p = [...document.querySelectorAll('.pill[data-i] .pick')]; p[0].click(); p[1].click(); document.querySelector('.pill[data-i="1"] [data-mk]').click(); });
  await shot('concerns'); await nextBtn();

  // Early directions: wait for the art, rate all four.
  for (let s = 0; s < 4; s++) {
    if (s === 0) { await onScreen('teasersintro'); await shot('teasersintro'); await nextBtn(); }
    await onScreen('teasers', s); await settled();
    if (s === 0) {
      await page.until(() => document.querySelector('.tcard:not(.back1):not(.back2)')?.style.backgroundImage.includes('/img/'), { label: 'concept art', timeout: 120000 });
      await new Promise((r) => setTimeout(r, 1200)); await shot('teasers');
    }
    log(`direction ${s + 1}:`, await page.eval(() => document.querySelector('.tcard:not(.back1):not(.back2) h2').textContent));
    await click(`[data-r="${[0, 1, 0, 2][s]}"]`);
    await new Promise((r) => setTimeout(r, 900));
  }

  await onScreen('anything');
  await page.eval(() => { const f = document.querySelector('.composer .field'); f.textContent = 'Core banking can’t change before the 2027 migration. Anything member-facing needs board sign-off, and they meet quarterly.'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  await nextBtn();
  await onScreen('team');
  await page.eval(() => { const n = document.querySelector('.pname'), m = document.querySelector('.pmail'); n.value = 'Priya Raman'; n.dispatchEvent(new Event('input', { bubbles: true })); m.value = 'priya@example.com'; m.dispatchEvent(new Event('input', { bubbles: true })); });
  await nextBtn();
  await onScreen('end'); await new Promise((r) => setTimeout(r, 1500)); await shot('playback');

  // Refresh mid-flow must come back to the same screen with the same answers.
  await page.goto(`${BASE}/b/${brief.id}`); await onScreen('end');
  log('resume after refresh: ok');

  await nextBtn();
  await onScreen('sent'); await shot('sent');
  const pdf = await page.eval(async (id) => { const r = await fetch(`/b/${id}/pack.pdf`); return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength }; }, brief.id);
  log('team pack pdf:', pdf);
  if (pdf.status !== 200 || pdf.size < 10000) throw new Error('team pack PDF failed');

  await page.goto(`${BASE}/b/${brief.id}/pack?internal=1`);
  await page.until(() => document.querySelectorAll('.slide').length > 5, { label: 'internal pack', timeout: 60000 });
  log('internal pack slides:', await page.eval(() => document.querySelectorAll('.slide').length));
  await page.size(1300, 760); await shot('pack-internal');

  const errors = page.logs.filter((l) => /^(error|EXCEPTION)/.test(l));
  if (errors.length) { log('console errors:'); errors.forEach((e) => log('  ', e)); }
  log(`PASS in ${Math.round((Date.now() - t0) / 1000)}s, screenshots in ${OUT}, brief ${brief.id}`);
} catch (e) {
  await shot('FAILED').catch(() => {});
  log('FAIL on', await screen().catch(() => '?'), '-', e.message);
  const live = await page.eval(() => { const c = {}; (window.__live || []).forEach((t) => c[t] = (c[t] || 0) + 1); return c; }).catch(() => null);
  if (live && Object.keys(live).length) log('voice events:', JSON.stringify(live));
  page.logs.slice(-20).forEach((l) => log('  ', l));
  process.exitCode = 1;
} finally {
  await page.close();
}

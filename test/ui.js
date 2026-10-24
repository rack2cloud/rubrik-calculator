'use strict';
// Behavior tests against the BUILT page (dist/index.html), served with the production headers.
const assert = require('assert'), path = require('path'), fs = require('fs');
const { serve } = require('../scripts/serve.js'), launch = require('../scripts/launch.js');
let n = 0; const ok = (c, m, d) => { if (!c) { console.log('FAIL ' + m + (d ? ' ' + JSON.stringify(d) : '')); process.exitCode = 1; throw new Error(m); } n++; console.log('PASS ' + m); };
(async () => {
  const s = await serve(path.join(__dirname, '..', 'dist'), 0), br = await launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(s.url); await page.waitForSelector('#rp .total');
  const shots = path.join(__dirname, '..', 'shots'); fs.mkdirSync(shots, { recursive: true });
  const txt = sel => page.textContent(sel);

  // 1 empty state
  let rp = await txt('#rp');
  ok(/No total yet/.test(rp) && !/\$0\b/.test(rp), 'empty state: no total and no $0');
  ok((await page.$$('#form .chip.req')).length >= 3, 'empty state: required chips shown on missing rates and metric');
  ok(await page.getAttribute('[data-act=platform][data-v=vmware]', 'aria-pressed') === 'true', 'platform toggle exposes aria-pressed');
  await page.screenshot({ path: path.join(shots, 'desktop-empty.png'), fullPage: true });

  // 2 illustrative example
  await page.click('#form [data-act=example]');
  rp = await txt('#rp');
  ok(/Annualized stack total/.test(rp) && /\$39,600/.test(rp), 'example: complete total = 96 cores x 100 + 30 TB x 1,000');
  ok(/Illustrative/.test(rp) && /Needs confirmation/.test(rp), 'example: illustrative and needs-confirmation chips present');
  ok(!/Entered by you/.test(await txt('#rp .total')), 'example: total does not claim values were entered by the user');
  await page.screenshot({ path: path.join(shots, 'desktop-example.png'), fullPage: true });

  // 3 entering a value clears its illustrative status
  await page.fill('#f-rrate', '1200');
  rp = await txt('#rp'); ok(/\$45,600/.test(rp), 'editing the Rubrik rate recalculates (96x100 + 30x1,200 = 45,600)');
  ok(!/Illustrative/.test(await txt('#chip-rrate')) && /Entered by you/.test(await txt('#chip-rrate')), 'editing a rate flips its chip to Entered by you');
  await page.check('#f-confirm'); ok(/Confirmed by you/.test(await txt('#chip-metric')), 'confirming the metric flips its chip');

  // 4 BETB needs a ratio
  await page.click('[data-act=metric][data-v=BETB]');
  rp = await txt('#rp'); ok(/Partial total: platform only/.test(rp) && /modeled reduction ratio/.test(rp), 'BETB without a ratio: partial platform-only total and the ratio is named as needed');
  await page.fill('#f-ratio', '3'); rp = await txt('#rp'); ok(/Annualized stack total/.test(rp), 'BETB with ratio completes the total');
  ok(/\$21,600/.test(await txt('#rp .total')), 'BETB: 30 TB / 3 = 10 BETB x 1,200 + 9,600 = 21,600');
  ok(/Modeled/.test(await page.getAttribute('.bridge', 'aria-label')) , 'bridge exposes a text alternative');
  await page.screenshot({ path: path.join(shots, 'desktop-betb.png'), fullPage: true });

  // 5 platform switch never changes the Rubrik metric
  await page.click('[data-act=platform][data-v=hyperv]');
  ok(await page.getAttribute('[data-act=metric][data-v=BETB]', 'aria-pressed') === 'true', 'switching platform leaves the Rubrik metric untouched');
  ok(!!(await page.$('#f-amort')), 'Hyper-V shows the amortization input');
  await page.fill('#f-rate', '');
  ok(/Needs: Datacenter 16-core pack price/.test(await txt('#rp')), 'Hyper-V without a price reports what is needed');
  await page.fill('#f-rate', '6000'); await page.fill('#f-amort', '3');
  rp = await txt('#rp'); ok(/amortized, not a subscription/.test(rp) && /One-time/.test(rp), 'Hyper-V result shows the one-time cost and amortization, not OPEX');

  // 6 invalid structure
  await page.click('[data-act=platform][data-v=vmware]'); await page.fill('#f-hosts', '0');
  ok(!(await page.$eval('#errs', e => e.hidden)), 'invalid host count shows an error list');
  ok(!!(await page.$('#fld-hosts.invalid')), 'invalid field is marked');
  await page.fill('#f-hosts', '3');

  // 7 copy and print
  await page.click('#btn-copy'); const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(/Rubrik Virtual Stack TCO Calculator/.test(clip) && /Excludes:/.test(clip) && /not a quote/.test(clip) && /Status key/.test(clip), 'copy results writes a readable summary with exclusions and status key');
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('[data-act=print]'); ok(await page.evaluate(() => window.__printed) === 1, 'print opens the browser print dialog once');
  const rpt = await page.innerHTML('#print-report'); ok(/Excluded from this estimate/.test(rpt) && /Status key/.test(rpt) && /Platform/.test(rpt) && /Rubrik protection/.test(rpt), 'print report includes inputs, statuses and exclusions');
  await page.emulateMedia({ media: 'print' });
  const vis = await page.evaluate(() => ({ rpt: getComputedStyle(document.getElementById('print-report')).display, hdr: getComputedStyle(document.querySelector('.header')).display, bg: getComputedStyle(document.getElementById('print-report')).backgroundColor }));
  ok(vis.rpt === 'block' && vis.hdr === 'none' && vis.bg === 'rgb(255, 255, 255)', 'print media: only the report shows, on a white background', vis);
  await page.pdf({ path: path.join(shots, 'print.pdf'), format: 'Letter' });
  await page.emulateMedia({ media: 'screen' });

  // 8 labels and focus
  const unlabeled = await page.$$eval('input:not([type=hidden]), select', els => els.filter(e => !(e.id && document.querySelector(`label[for="${e.id}"]`)) && !e.getAttribute('aria-label') && !e.closest('label')).map(e => e.id));
  ok(unlabeled.length === 0, 'every input and select has a label', unlabeled);

  // 9 mobile
  const m = await br.newContext({ viewport: { width: 375, height: 800 } }); const mp = await m.newPage(); await mp.goto(s.url); await mp.click('#form [data-act=example]');
  const geo = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sticky: getComputedStyle(document.getElementById('results')).position, mbar: getComputedStyle(document.getElementById('mbar')).display, order: document.getElementById('form').getBoundingClientRect().top < document.getElementById('results').getBoundingClientRect().top + window.scrollY }));
  ok(geo.sw <= geo.cw, 'mobile: no horizontal scroll', geo); ok(geo.sticky === 'static' && geo.mbar === 'flex', 'mobile: results panel is not sticky and a compact bar is shown', geo);
  ok(/\$39,600/.test(await mp.textContent('#mbar')), 'mobile bar shows the total');
  await mp.screenshot({ path: path.join(shots, 'mobile.png'), fullPage: true });
  const tab = await br.newContext({ viewport: { width: 820, height: 900 } }); const tp = await tab.newPage(); await tp.goto(s.url); const tw = await tp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth); ok(tw, 'tablet width: no horizontal scroll');

  // ---- review round: provenance, provisional state, scrolling, report, logo ----
  const np = await ctx.newPage(); await np.goto(s.url); await np.waitForSelector('#rp .total');
  const T = sel => np.textContent(sel);
  ok(/Illustrative sample configuration/.test(await T('#derived-platform')), 'platform: sample host/CPU/core counts are labeled illustrative until edited');
  await np.click('#form [data-act=example]');
  ok(/provisional/i.test(await T('#rp .total .tl')) && /not confirmed in your order/.test(await T('#rp .total .ts')), 'unconfirmed metric: the total is labeled provisional');
  ok(/Illustrative configuration/.test(await T('#rp .total .chips')), 'the total carries the illustrative-configuration status');
  ok(/rate applies to the protected front-end capacity/i.test(await T('#derived-rubrik')) && /Provisional/.test(await T('#derived-rubrik')), 'FETB: says which quantity the rate applies to, and that it is provisional');
  await np.check('#f-confirm');
  ok(!/provisional/i.test(await T('#rp .total .tl')) && !/Provisional/.test(await T('#derived-rubrik')), 'confirming the metric removes the provisional state');
  await np.click('[data-act=metric][data-v=BETB]');
  ok(/Enter a reduction ratio/.test(await T('#derived-rubrik')) && /assumption, not a Rubrik figure/.test(await T('#derived-rubrik')), 'BETB without a ratio: requires one and calls it an assumption');
  await np.fill('#f-ratio', '3'); await np.fill('#f-fetb', '30');
  ok(/10 BETB/.test(await T('#derived-rubrik')) && /assumption, not a Rubrik figure/.test(await T('#derived-rubrik')), 'BETB with a ratio: shows the division and labels the ratio an assumption');
  // no inner scrolling at desktop widths, with the tallest state loaded
  const sc = await np.evaluate(() => { const r = document.getElementById('results'), cs = getComputedStyle(r); return { ov: cs.overflowY, fits: r.scrollHeight <= r.clientHeight + 1 }; });
  ok(sc.ov === 'visible' && sc.fits, 'results panel has no internal scrollbar', sc);
  await np.setViewportSize({ width: 1440, height: 700 });
  const sc2 = await np.evaluate(() => getComputedStyle(document.getElementById('results')).position);
  ok(sc2 === 'static', 'short viewport: panel is not pinned, so nothing can be cut off', sc2);
  await np.setViewportSize({ width: 1440, height: 1000 });
  // platform edit marks configuration as entered; Clear keeps platform configuration
  await np.fill('#f-hosts', '5');
  ok(/Configuration entered by you/.test(await T('#derived-platform')), 'editing hosts marks the configuration as entered');
  await np.fill('#f-rate', '100'); await np.click('#form [data-act=clear]');
  ok(await np.inputValue('#f-hosts') === '5' && /Configuration entered by you/.test(await T('#derived-platform')), 'Clear keeps the platform configuration and its status');
  ok(await np.inputValue('#f-rate') === '' && await np.inputValue('#f-fetb') === '' && await np.inputValue('#f-rrate') === '', 'Clear empties the platform rate and the Rubrik inputs');
  // copy and print carry inputs, units, status and exclusions
  await np.click('#form [data-act=example]'); await np.fill('#f-hosts', '4');
  await np.click('[data-act=copy]'); const clip2 = await np.evaluate(() => navigator.clipboard.readText());
  ok(/4 hosts x 2 CPUs x 16 cores \(entered by you\)/.test(clip2) && /per core per year/.test(clip2) && /per TB per year/.test(clip2) && /PROVISIONAL/.test(clip2) && /Excludes:/.test(clip2) && /Status key/.test(clip2), 'copied text carries inputs, rate units, provisional state, status key and exclusions', clip2);
  await np.evaluate(() => { window.print = () => {}; });
  await np.click('[data-act=print]');
  await np.emulateMedia({ media: 'print' });
  const pr = await np.evaluate(() => { const r = document.getElementById('print-report'), im = r.querySelector('.rpt-logo'), b = im.getBoundingClientRect(); return { text: r.innerText, logoLoaded: im.complete && im.naturalWidth > 0, logoW: Math.round(b.width), shown: getComputedStyle(r).display }; });
  ok(pr.shown === 'block' && pr.logoLoaded && pr.logoW >= 200, 'print: the full logo is loaded and rendered at report size', pr);
  ok(['Hosts, CPUs, cores', 'entered by you', 'per core per year', 'per TB per year', 'Status key', 'Excluded from this estimate', 'PROVISIONAL', 'Modeled quantity', 'not a quote'].every(k => pr.text.includes(k)), 'print: report holds inputs, units, statuses, exclusions and the provisional state', pr.text.slice(0, 400));
  fs.mkdirSync(shots, { recursive: true }); await np.pdf({ path: path.join(shots, 'report.pdf'), format: 'Letter', printBackground: false });
  await np.emulateMedia({ media: 'screen' });
  // mobile: the bar never covers the end of the page and hides while the result is in view
  await mp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const mg = await mp.evaluate(() => { const links = document.querySelectorAll('.tool-footer a'), f = links[links.length - 1].getBoundingClientRect(), b = document.getElementById('mbar'), br = b.getBoundingClientRect(); return { footerBottom: f.bottom, barTop: br.top, barShown: getComputedStyle(b).display !== 'none' }; });
  ok(!mg.barShown || mg.footerBottom <= mg.barTop + 1, 'mobile: the bottom bar does not cover the end of the page', mg);
  await mp.evaluate(() => document.getElementById('results').scrollIntoView()); await mp.waitForTimeout(250);
  ok(await mp.evaluate(() => getComputedStyle(document.getElementById('mbar')).display) === 'none', 'mobile: the bar is hidden while the full result is on screen');
  await np.close();

  const iconOk = await page.evaluate(() => { const i = document.querySelector('.brand-icon'); return i.complete && i.naturalWidth > 0; });
  ok(iconOk, 'header icon loads (naturalWidth > 0)');
  const selOk = await page.evaluate(() => { const s = document.querySelector('#f-runit'); return s ? s.scrollWidth <= s.clientWidth + 1 : true; });
  ok(selOk, 'rate-unit select not truncated');
  ok(errors.length === 0, 'no console or page errors', errors);
  await br.close(); s.srv.close(); console.log(`\n${n} UI checks passed`);
})().catch(e => { console.error(e.message); process.exit(1); });

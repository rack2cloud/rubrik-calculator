'use strict';
// Privacy gate for the BUILT application. Usage: node scripts/privacy-check.js [--expect-claim]
//  1. static scan of dist/ (secondary guardrail, not proof)
//  2. response headers as served, compared with vercel.json
//  3. headless-Chromium network capture across a full session of interactions (primary evidence)
// Writes shots/network-capture*.json. Exit code 1 on any failure.
const path = require('path'), fs = require('fs'), http = require('http');
const { serve } = require('./serve.js'), launch = require('./launch.js');
const dist = path.join(__dirname, '..', 'dist'), expectClaim = process.argv.includes('--expect-claim');
const failures = [], report = { generated: new Date().toISOString(), expect_claim: expectClaim, checks: [] };
const check = (name, okk, detail) => { report.checks.push({ name, pass: !!okk, detail: detail === undefined ? null : detail }); if (!okk) failures.push(name + (detail ? ': ' + JSON.stringify(detail) : '')); };

(async () => {
  // ---- 1. static scan ----
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const refOk = u => /^(fonts\/[a-z0-9-]+\.woff2|assets\/r2c-icon\.svg)$/.test(u);
  const loaders = [...html.matchAll(/<(?:script|img|iframe|source|video|audio|embed|object)\b[^>]*\b(?:src|data)=["']([^"']+)["']/gi)].map(m => m[1])
    .concat([...html.matchAll(/<link\b(?![^>]*rel=["']canonical["'])[^>]*\bhref=["']([^"']+)["']/gi)].map(m => m[1]));
  check('static: every resource reference is a same-origin local font or the local icon', loaders.every(refOk), loaders.filter(u => !refOk(u)));
  const cssUrls = [...html.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
  check('static: CSS url() references are local fonts only', cssUrls.every(u => /^fonts\/[a-z0-9-]+\.woff2$/.test(u)), cssUrls.filter(u => !/^fonts\//.test(u)));
  const banned = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'new Worker', 'SharedWorker', 'serviceWorker', 'importScripts', 'import(', 'gtag', 'dataLayer', 'plausible', 'umami', 'matomo', 'hotjar', '_vercel', 'speed-insights', 'cloudflareinsights', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'googleapis', 'gstatic'];
  const hit = banned.filter(b => script.includes(b));
  check('static: no network, storage, cookie or analytics APIs in the script (guardrail only)', hit.length === 0, hit);
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(m => m[1]);
  check('static: fixed links are user-initiated navigation to rack2cloud.com only', hrefs.every(h => /^https:\/\/www\.rack2cloud\.com\//.test(h) || h.startsWith('#')), hrefs.filter(h => !h.startsWith('#') && !/^https:\/\/www\.rack2cloud\.com\//.test(h)));
  const fonts = fs.readdirSync(path.join(dist, 'fonts')).filter(f => !f.startsWith('LICENSE'));
  check('static: shipped fonts are WOFF2 with valid signatures', fonts.length === 9 && fonts.every(f => f.endsWith('.woff2') && fs.readFileSync(path.join(dist, 'fonts', f)).slice(0, 4).toString() === 'wOF2'), fonts);
  const claimPresent = /inputs are never transmitted/.test(html);
  check(expectClaim ? 'claim: privacy statement is present in this build' : 'claim: privacy statement is absent from the pre-capture build', claimPresent === expectClaim, { claimPresent });

  // ---- 2. headers as served ----
  const s = await serve(dist, 0);
  const get = p => new Promise((res, rej) => http.get(s.url + p, r => { r.resume(); res(r); }).on('error', rej));
  const root = await get('/'), got = root.headers, icon = await get('/assets/r2c-icon.svg');
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  check('headers: served CSP = meta CSP + frame-ancestors', got['content-security-policy'] === meta + "; frame-ancestors 'none'", got['content-security-policy']);
  check("headers: connect-src 'none', no unsafe-inline/unsafe-eval, script and style locked to hashes", /connect-src 'none'/.test(meta) && !/unsafe-/.test(meta) && /script-src 'sha256-/.test(meta) && /style-src 'sha256-/.test(meta), meta);
  check('headers: nosniff, frame deny, referrer policy', got['x-content-type-options'] === 'nosniff' && got['x-frame-options'] === 'DENY' && !!got['referrer-policy']);
  check('headers: icon served as image/svg+xml', icon.statusCode === 200 && /^image\/svg\+xml/.test(icon.headers['content-type'] || ''), icon.headers['content-type']);
  const vj = path.join(__dirname, '..', 'vercel.json');
  if (fs.existsSync(vj)) { const v = JSON.parse(fs.readFileSync(vj, 'utf8')); const hs = Object.fromEntries(v.headers[0].headers.map(h => [h.key.toLowerCase(), h.value])); check('vercel.json: deployed header config matches the served headers', hs['content-security-policy'] === got['content-security-policy'] && hs['x-frame-options'] === 'DENY', hs); }
  else check('vercel.json: deployed header config exists', false);

  // ---- 3. network capture ----
  const br = await launch(), ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const requests = [];
  ctx.on('request', r => requests.push({ method: r.method(), url: r.url(), type: r.resourceType(), post: !!r.postData() }));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__sec = []; document.addEventListener('securitypolicyviolation', e => window.__sec.push(e.violatedDirective + ' ' + e.blockedURI));
    const wrap = (o, k, n) => { if (o && o[k]) { const f = o[k]; o[k] = function () { window.__sec.push('called ' + n); return f.apply(this, arguments); }; } };
    wrap(window, 'fetch', 'fetch'); wrap(navigator, 'sendBeacon', 'sendBeacon'); wrap(XMLHttpRequest.prototype, 'send', 'xhr.send');
    if (window.WebSocket) window.WebSocket = new Proxy(window.WebSocket, { construct() { window.__sec.push('called WebSocket'); throw new Error('blocked'); } });
    window.print = () => {};
  });
  await page.goto(s.url); await page.waitForSelector('#rp');
  await page.click('#form [data-act=example]');
  for (const p of ['nutanix', 'hyperv', 'vmware']) { await page.click(`[data-act=platform][data-v=${p}]`); await page.waitForTimeout(80); }
  await page.click('[data-act=edition][data-v=VCF]'); await page.click('[data-act=edition][data-v=VVF]');
  await page.click('[data-act=metric][data-v=BETB]'); await page.fill('#f-ratio', '3'); await page.check('#f-confirm');
  await page.fill('#f-fetb', '120'); await page.fill('#f-rrate', '90'); await page.selectOption('#f-runit', 'perTBMonth');
  await page.fill('#f-hosts', '0'); await page.fill('#f-hosts', '6');
  await page.click('[data-act=metric][data-v=FETB]');
  await page.click('[data-act=copy]'); await page.click('[data-act=print]');
  await page.setViewportSize({ width: 360, height: 780 }); await page.click('#mbar'); await page.waitForTimeout(150);
  await page.click('#form [data-act=clear]'); await page.waitForTimeout(150);
  const sec = await page.evaluate(() => window.__sec), cookies = await ctx.cookies();
  const storage = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length }));
  const origin = new URL(s.url).origin;
  check('capture: every request in the session is same-origin', requests.every(r => new URL(r.url).origin === origin), requests.filter(r => new URL(r.url).origin !== origin));
  check('capture: no request other than GET', requests.every(r => r.method === 'GET' && !r.post), requests.filter(r => r.method !== 'GET'));
  const allowed = r => r.url === s.url + '/' || /\/fonts\/[a-z0-9-]+\.woff2$/.test(r.url) || r.url === s.url + '/assets/r2c-icon.svg';
  check('capture: the only requests are the page, local WOFF2 fonts and the local icon', requests.every(allowed), requests.filter(r => !allowed(r)));
  check('capture: no scripts, stylesheets, XHR/fetch, workers or websockets were requested', !requests.some(r => ['script', 'stylesheet', 'xhr', 'fetch', 'websocket', 'ping', 'eventsource'].includes(r.type)), requests.map(r => r.type));
  check('capture: no CSP violations and no calls to fetch / sendBeacon / XHR / WebSocket', sec.length === 0, sec);
  check('capture: no cookies and no web storage were created', cookies.length === 0 && storage.ls === 0 && storage.ss === 0, { cookies, storage });
  const text = await page.evaluate(() => document.body.textContent);
  check(expectClaim ? 'claim: the statement is displayed in the capture session' : 'claim: the statement is not displayed before the capture passes', /inputs are never transmitted/.test(text) === expectClaim);
  report.requests = requests; report.csp_violations = sec; report.served_headers = got; report.cookies = cookies; report.storage = storage;
  await br.close(); s.srv.close();
  fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'shots', expectClaim ? 'network-capture-claim-build.json' : 'network-capture.json'), JSON.stringify(report, null, 2));
  report.checks.forEach(c => console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name));
  console.log(`requests captured: ${requests.length} (${requests.map(r => r.type).join(', ')})`);
  if (failures.length) { console.log('\nFAILED:\n' + failures.join('\n')); process.exit(1); }
  console.log('privacy gate: all checks passed');
})();

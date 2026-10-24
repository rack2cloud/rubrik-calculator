'use strict';
// Assembles dist/index.html from src/*. No bundler: concatenation + CSP hashes. dist/ is generated; never hand-edit it.
// Usage: node scripts/build.js [--claim]   (--claim adds the privacy statements; only used after the capture test passes)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const claim = process.argv.includes('--claim');
const strip = s => s.replace(/^'use strict';\n/m, '').replace(/^\s*if \(typeof module !== 'undefined'\)[^\n]*\n/gm, '');
const js = ["'use strict';", strip(src('engine.js')), strip(src('ui.js'))].join('\n');
const css = src('ui.css');
const PRIVACY = {
  hero: '<div><span class="ck">&#10003;</span>Calculations run in your browser; inputs are never transmitted.</div>',
  footer: '&#128274; No cookies. No tracking. Calculations run in your browser; inputs are never transmitted. &nbsp;|&nbsp;'
};
const body = src('ui.body.html').replace('{{PRIVACY_HERO}}', claim ? PRIVACY.hero : '').replace('{{PRIVACY_FOOTER}}', claim ? PRIVACY.footer : '');
const h = s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";
const csp = ["default-src 'self'", `script-src ${h(js)}`, `style-src ${h(css)}`, "connect-src 'none'", "font-src 'self'", "img-src 'self' data:", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
const title = 'Rubrik Virtual Stack TCO Calculator | rack2cloud';
const desc = 'Rubrik Virtual Stack TCO Calculator: annualize VMware, Nutanix or Hyper-V licensing next to Rubrik protection cost, with every rate and assumption labelled.';
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="https://rvstc.rack2cloud.com/">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/svg+xml" href="assets/r2c-icon.svg">
<link rel="preload" href="fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/jetbrains-mono-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;
const dist = path.join(root, 'dist'); fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true }); fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of fs.readdirSync(path.join(root, 'fonts'))) if (f.endsWith('.woff2') || f.startsWith('LICENSE')) fs.copyFileSync(path.join(root, 'fonts', f), path.join(dist, 'fonts', f));
fs.copyFileSync(path.join(root, 'assets', 'r2c-icon.svg'), path.join(dist, 'assets', 'r2c-icon.svg'));
const headers = { 'Content-Security-Policy': csp + "; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
fs.mkdirSync(path.join(root, '.build'), { recursive: true }); fs.writeFileSync(path.join(root, '.build', 'headers.json'), JSON.stringify(headers, null, 2));
fs.writeFileSync(path.join(root, 'vercel.json'), JSON.stringify({ framework: null, installCommand: null, buildCommand: null, outputDirectory: 'dist', headers: [{ source: '/(.*)', headers: Object.entries(headers).map(([key, value]) => ({ key, value })) }] }, null, 2) + '\n');
console.log(`built dist/index.html (${html.length} bytes)${claim ? ' with privacy claim' : ''}`);

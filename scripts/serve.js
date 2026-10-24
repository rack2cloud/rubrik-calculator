'use strict';
// Static server for dist/ that applies the same headers as vercel.json (from dist/_headers.json). Local checks only.
const http = require('http'), fs = require('fs'), path = require('path');
function serve(dir, port) {
  const hdr = JSON.parse(fs.readFileSync(path.join(dir, '..', '.build', 'headers.json'), 'utf8'));
  const types = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json', '.txt': 'text/plain' };
  const log = [];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]); log.push(req.method + ' ' + u);
    const f = path.join(dir, u === '/' ? 'index.html' : u);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, hdr); return res.end('not found'); }
    res.writeHead(200, Object.assign({ 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }, hdr));
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, log, url: `http://127.0.0.1:${srv.address().port}` })));
}
module.exports = { serve };
if (require.main === module) serve(path.join(__dirname, '..', 'dist'), 8123).then(s => console.log('serving ' + s.url));

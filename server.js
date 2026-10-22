/* The Innovation Brief server. Zero dependencies: Node 22+ and nothing to install.

   Pages
     /                      Digital Labs console: create a brief, see what came back
     /p/<personId>          the link you send the client (resolves to their latest brief)
     /b/<id>                a specific brief (still works for old links)
     /b/<id>/pack           the team pack, generated from their answers (?internal=1 for Digital Labs)
     /b/<id>/pack.pdf       the same, as a PDF (needs Google Chrome on the server)

   Everything the browser asks the AI for goes through /api, so keys and prompts stay here. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import { config, publicConfig, ROOT } from './lib/config.js';
import * as store from './lib/store.js';
import { HttpError } from './lib/errors.js';
import { ProviderError } from './lib/providers/index.js';
import { handleAdmin } from './routes/admin.js';
import { handleBriefs, makePack, assemblePack, CHROME, printPDF } from './routes/briefs.js';

const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json' };
const MB = 1024 * 1024;
const STATIC = new Set(['scripts', 'styles', 'images']);

/* ---------- security headers ---------- */
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'microphone=(self)',
};
// pack.html uses an inline <script> block, so script-src needs 'unsafe-inline'.
// style-src 'unsafe-inline' covers the many dynamic style= attributes in both pages.
const HTML_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ');

/* ---------- small helpers ---------- */
const send = (res, status, body, type = 'application/json; charset=utf-8', headers = {}) => {
  const extra = { ...SEC };
  if (type.startsWith('text/html')) extra['Content-Security-Policy'] = HTML_CSP;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra, ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const page = (res, file) => send(res, 200, readFileSync(join(PUBLIC, file)), TYPES['.html']);

async function body(req, limit = 2 * MB) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const json = async (req, limit) => { const b = await body(req, limit); try { return b.length ? JSON.parse(b) : {}; } catch { throw new HttpError(400, 'Bad JSON'); } };

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => c.split('=').map(decodeURIComponent)));
const isStaff = (req, url) => !config.consoleToken || url.searchParams.get('token') === config.consoleToken || cookies(req).dl === config.consoleToken;
const staffCookie = (url) => config.consoleToken && url.searchParams.get('token') === config.consoleToken
  ? { 'Set-Cookie': `dl=${encodeURIComponent(config.consoleToken)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000` } : {};

/* ---------- routes ---------- */
async function api(req, res, url, parts) {
  const [, , first] = parts;

  if (first === 'config') return send(res, 200, publicConfig());

  const ctx = { send, json, body, isStaff, MB };
  if (first === 'console') return handleAdmin(req, res, url, parts, ctx);
  if (first === 'briefs' && store.validId(parts[3])) return handleBriefs(req, res, url, parts, ctx);

  throw new HttpError(404, 'Not found');
}

async function handle(req, res) {
  let url = null;
  try {
    url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/');
    if (parts[1] === 'api') return await api(req, res, url, parts);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');

    if (url.pathname === '/') {
      if (!isStaff(req, url)) return send(res, 403, 'This page is for Digital Labs.', 'text/plain; charset=utf-8');
      res.setHeader('Set-Cookie', staffCookie(url)['Set-Cookie'] || []);
      return page(res, 'console.html');
    }
    if (parts[1] === 'p' && store.validPersonId(parts[2])) {
      const person = store.getPerson(parts[2]);
      if (!person) return send(res, 404, readFileSync(join(PUBLIC, 'missing.html')), TYPES['.html']);
      const b = store.resolvePersonBrief(person.id);
      if (!b) return send(res, 500, { error: 'Could not create brief' });
      res.writeHead(302, { Location: `/b/${b.id}` });
      return res.end();
    }
    if (parts[1] === 'b' && store.validId(parts[2])) {
      const b = store.get(parts[2]);
      if (!b) return send(res, 404, readFileSync(join(PUBLIC, 'missing.html')), TYPES['.html']);
      if (!parts[3]) return page(res, 'brief.html');
      if (parts[3] === 'pack') return page(res, 'pack.html');
      if (parts[3] === 'pack.pdf') {
        if (!CHROME) return send(res, 501, 'No Chrome on this server to make a PDF. Open /pack and print it instead.', 'text/plain; charset=utf-8');
        if (b.status !== 'sent') throw new HttpError(409, 'Not sent yet');
        if (!b.pack) await makePack(b.id);
        const internal = url.searchParams.has('internal') && isStaff(req, url);
        mkdirSync(store.dir(b.id, 'out'), { recursive: true });
        const out = store.dir(b.id, 'out', internal ? 'internal-brief.pdf' : 'team-pack.pdf');
        const tok = internal && config.consoleToken ? `&token=${encodeURIComponent(config.consoleToken)}` : '';
        await printPDF(`http://127.0.0.1:${config.port}/b/${b.id}/pack?print=1${internal ? '&internal=1' : ''}${tok}`, out);
        const name = `${b.client} ${internal ? 'internal brief' : 'team pack'}.pdf`.replace(/[^\w .-]/g, '');
        return send(res, 200, readFileSync(out), 'application/pdf', { 'Content-Disposition': `${url.searchParams.has('dl') ? 'attachment' : 'inline'}; filename="${name}"` });
      }
    }
    if (STATIC.has(parts[1])) {
      const p = join(PUBLIC, parts[1], ...parts.slice(2).filter((s) => s && s !== '..'));
      if (p.startsWith(join(PUBLIC, parts[1])) && existsSync(p) && statSync(p).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return createReadStream(p).on('error', () => res.destroy()).pipe(res);
      }
    }
    return send(res, 404, readFileSync(join(PUBLIC, 'missing.html')), TYPES['.html']);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 || e instanceof ProviderError) console.error(`${req.method} ${url?.pathname}:`, e.message);
    if (res.headersSent) return res.end();
    const msg = e instanceof HttpError ? e.message : e instanceof ProviderError ? "The AI service couldn't do that just now" : 'Something went wrong';
    return send(res, e instanceof ProviderError ? 502 : status, { error: msg });
  }
}

import { ai } from './lib/providers/index.js';
createServer((req, res) => handle(req, res).catch((e) => { console.error('unhandled:', e); try { res.destroy(); } catch {} })).listen(config.port, config.host, () => {
  console.log(`Innovation Brief running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  const host = (c) => { try { return new URL(c.baseURL).host; } catch { return c.baseURL; } };
  for (const [k, label] of [['text', 'text'], ['docs', 'docs'], ['image', 'image'], ['voice', 'voice'], ['transcribe', 'dictate']])
    console.log(`  ${label.padEnd(8)}${ai[k].name.padEnd(34)}${ai[k].name === 'none' ? '(off: no provider, or no key for this endpoint)' : `→ ${host(config[k])}`}`);
  if (!CHROME) console.log('  (no Chrome found: the pack downloads as a web page, not a PDF)');
});

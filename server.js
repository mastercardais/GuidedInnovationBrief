/* The Innovation Brief server. Zero dependencies: Node 22+ and nothing to install.

   Pages
     /                      Digital Labs console: create a brief, see what came back
     /p/<personId>          the link you send the client (resolves to their latest brief)
     /b/<id>                a specific brief (still works for old links)
     /b/<id>/pack           the team pack, generated from their answers (?internal=1 for Digital Labs)
     /b/<id>/pack.pdf       the same, as a PDF (needs Google Chrome on the server)

   Everything the browser asks the AI for goes through /api, so keys and prompts stay here. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, createReadStream, statSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { config, publicConfig, ROOT } from './lib/config.js';
import * as store from './lib/store.js';
import * as gen from './lib/brief.js';
import { ai, ProviderError } from './lib/providers/index.js';

const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json' };
const MB = 1024 * 1024;

/* ---------- small helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const send = (res, status, body, type = 'application/json; charset=utf-8', headers = {}) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const page = (res, file) => send(res, 200, readFileSync(join(PUBLIC, file)), TYPES['.html']);

async function body(req, limit = 2 * MB) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'Too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const json = async (req, limit) => { const b = await body(req, limit); try { return b.length ? JSON.parse(b) : {}; } catch { throw new HttpError(400, 'Bad JSON'); } };

// The console and the internal pack. With no CONSOLE_TOKEN set (the default, local use) they're open.
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => c.split('=').map(decodeURIComponent)));
const isStaff = (req, url) => !config.consoleToken || url.searchParams.get('token') === config.consoleToken || cookies(req).dl === config.consoleToken;
const staffCookie = (url) => config.consoleToken && url.searchParams.get('token') === config.consoleToken
  ? { 'Set-Cookie': `dl=${encodeURIComponent(config.consoleToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` } : {};

// What the client's page gets: never the digest summary, never another brief.
const clientView = (b) => ({
  id: b.id, personId: b.personId || null, client: b.client, contact: b.contact, role: b.role, status: b.status,
  docs: b.docs.map(({ id, name, size, mime }) => ({ id, name, size, mime })),
  findings: b.digest?.findings || null, answers: b.answers, sentAt: b.sentAt,
});

/* ---------- the pack: their answers, plus the copy the model writes ---------- */
const packJobs = new Map();
function makePack(id) {
  if (packJobs.has(id)) return packJobs.get(id);
  const p = (async () => {
    const b = store.get(id);
    const copy = await gen.packCopy(b, b.facts || {});
    store.update(id, (x) => { x.pack = copy; });
    return copy;
  })().finally(() => packJobs.delete(id));
  packJobs.set(id, p);
  return p;
}
/* Nothing on the client's pages may be something they didn't say (the cover promises "we have corrected
   nothing and added nothing"). The quote is gently cleaned (filler, stutters, grammar), so we match on
   word overlap rather than exact substring — at least 60% of the quote's substantive words must appear
   in what they said. */
const norm = (t) => String(t || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const FILLER = new Set(['the', 'a', 'an', 'is', 'it', 'to', 'and', 'of', 'in', 'for', 'on', 'that', 'this', 'was', 'we', 'i', 'my', 'our', 'but', 'so', 'um', 'uh', 'like']);
const saidByThem = (quote, f) => {
  const qw = norm(quote).split(' ').filter((w) => w.length > 2 && !FILLER.has(w));
  if (qw.length < 3) return false;
  const theirs = new Set(norm([f.dump, ...(f.transcript || []).filter((m) => m.who === 'client').map((m) => m.text), f.anythingElse].join(' ')).split(' '));
  const hits = qw.filter((w) => theirs.has(w)).length;
  return hits / qw.length >= 0.6;
};
const overlap = (a, b) => { const A = new Set(norm(a).split(' ')), B = norm(b).split(' '); return B.filter((w) => w.length > 3 && A.has(w)).length; };
const optionalPackText = (value, missing) => {
  const text = String(value || '').trim();
  return !text || text.replace(/[.!?]+$/, '').toLowerCase() === missing.toLowerCase() ? null : text;
};

function assemblePack(b, internal) {
  const f = b.facts || {}, c = b.pack || {};
  const order = { 'We know this': 0, 'We think so': 1, 'Unsure': 2 };
  const conf = (f.confidence || []).filter((x) => x.band).sort((a, z) => order[a.band] - order[z.band]);
  const unsure = conf.find((x) => x.band === 'Unsure');
  if (unsure && c.confidenceRisk) unsure.risk = c.confidenceRisk;
  const d = new Date(b.sentAt || Date.now());
  const all = f.businessValue?.picked || [];
  const pack = {
    id: b.id,
    client: b.client,
    runner: c.runner || f.question || 'Innovation brief',
    date: d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
    filledBy: { name: b.contact, role: b.role || b.client },
    docs: b.docs.length,
    question: f.question || null,
    setAside: f.questionOthers || [],
    confidence: conf,
    customer: f.customer || null,
    changes: f.changes || [],
    changesLeftOut: (f.changesOffered || []).find((x) => !(f.changes || []).includes(x)) || null,
    quote: c.quote && saidByThem(c.quote, f) ? c.quote.trim() : null,
    // Only the business value they flagged is marked as the highest priority.
    businessValue: { priority: f.businessValue?.priority || null, also: all.filter((x) => x !== f.businessValue?.priority) },
    workshopOutcome: optionalPackText(c.workshopOutcome, 'Not stated'),
    story: f.story || null,
    cans: f.concerns?.picked?.length ? markBiggest(c.cans || [], f.concerns.biggest) : [],
    directions: f.directions || { loved: [], maybe: [], no: [] },
    anythingElse: f.anythingElse?.trim() || null,
    answering: [{ name: b.contact, role: b.role || '', state: 'Answered', done: true },
      ...(f.invited || []).filter((p) => p.name || p.email).map((p) => ({ name: p.name || p.email, role: p.name ? p.email : '', state: 'Invited' }))],
  };
  if (internal) Object.assign(pack, { internal: true, inspiration: optionalPackText(c.inspiration, 'None mentioned'), runsheet: c.runsheet || [], cut: c.cut || [], gaps: c.gaps || [] });
  return pack;
}

// "Your biggest concern" goes on the question that came from the worry they flagged, by its words, never
// by trusting the model's order.
function markBiggest(cans, biggest) {
  if (!biggest) return cans.map((x) => ({ ...x, biggest: false }));
  const scores = cans.map((x) => (norm(x.worry) === norm(biggest) ? 1000 : overlap(x.worry, biggest)));
  const best = scores.indexOf(Math.max(...scores));
  return cans.map((x, i) => ({ ...x, biggest: i === best && scores[i] > 0 })).sort((a, z) => z.biggest - a.biggest);
}

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
function printPDF(url, out) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=8000', `--print-to-pdf=${out}`, url], { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), 60_000);
    p.on('exit', (code) => { clearTimeout(t); code === 0 && existsSync(out) ? resolve(out) : reject(new Error(`chrome exited ${code}`)); });
    p.on('error', reject);
  });
}

/* ---------- routes ----------
   A null-prototype table: with a plain object, POST /gen/constructor resolved to Object() and handed
   the client the whole brief record, internal pack included. */
const GEN = Object.assign(Object.create(null), {
  frame: (b, x) => gen.frame(b, x.facts),
  question: (b, x) => gen.question(b, x.facts),
  photo: (b, x) => gen.photo(b, x.facts),
  story: (b, x) => gen.story(b, x.facts),
  directions: (b, x) => gen.directions(b, x.facts),
  regen: (b, x) => gen.regen(b, x.facts, x),
  chat: (b, x) => gen.chatTurn(b, x.facts, x.messages || []),
});

async function api(req, res, url, parts) {
  const [, , first, id, sub, arg] = parts; // '', 'api', ...
  const M = req.method;

  if (first === 'config') return send(res, 200, publicConfig());

  if (first === 'console') {
    if (!isStaff(req, url)) throw new HttpError(403, 'Not allowed');

    // --- overview: everything in one call for the flat console view ---
    if (id === 'overview' && M === 'GET') {
      const clients = store.listClients().map((c) => {
        const engagements = store.listEngagements(c.id).map((e) => {
          const people = store.listPeople(e.id).map((p) => {
            const briefs = store.listBriefsForPerson(p.id).map((b) => ({
              id: b.id, status: b.status, createdAt: b.createdAt, sentAt: b.sentAt,
              question: b.facts?.question || null, packReady: !!b.pack,
            }));
            return { ...p, briefs };
          });
          return { ...e, people };
        });
        return { ...c, engagements };
      });
      return send(res, 200, clients);
    }

    // --- clients ---
    if (id === 'clients' && !sub && M === 'GET') return send(res, 200, store.listClients());
    if (id === 'clients' && !sub && M === 'POST') {
      const x = await json(req);
      const name = String(x.name || '').trim();
      if (!name) throw new HttpError(400, 'Client name is required');
      return send(res, 201, store.createClient({ name }));
    }
    if (id === 'clients' && sub && M === 'DELETE') { store.deleteClient(sub); return send(res, 200, { ok: true }); }

    // --- engagements ---
    if (id === 'engagements' && !sub && M === 'GET') {
      const clientId = url.searchParams.get('client');
      if (!clientId) throw new HttpError(400, 'client param required');
      return send(res, 200, store.listEngagements(clientId));
    }
    if (id === 'engagements' && !sub && M === 'POST') {
      const x = await json(req);
      const clientId = String(x.clientId || '').trim(), name = String(x.name || '').trim();
      if (!clientId || !name) throw new HttpError(400, 'clientId and name are required');
      const e = store.createEngagement({ clientId, name });
      if (!e) throw new HttpError(404, 'Client not found');
      return send(res, 201, e);
    }
    if (id === 'engagements' && sub && M === 'DELETE') { store.deleteEngagement(sub); return send(res, 200, { ok: true }); }

    // --- people ---
    if (id === 'people' && !sub && M === 'GET') {
      const engId = url.searchParams.get('engagement');
      if (!engId) throw new HttpError(400, 'engagement param required');
      return send(res, 200, store.listPeople(engId));
    }
    if (id === 'people' && !sub && M === 'POST') {
      const x = await json(req);
      const engId = String(x.engagementId || '').trim(), name = String(x.name || '').trim();
      if (!engId || !name) throw new HttpError(400, 'engagementId and name are required');
      const p = store.createPerson({ engagementId: engId, name, email: x.email || '', role: x.role || '', sponsor: !!x.sponsor });
      if (!p) throw new HttpError(404, 'Engagement not found');
      return send(res, 201, p);
    }
    if (id === 'people' && sub && !arg && M === 'PUT') {
      const x = await json(req);
      const p = store.updatePerson(sub, x);
      if (!p) throw new HttpError(404, 'Person not found');
      return send(res, 200, p);
    }
    if (id === 'people' && sub && arg === 'reset' && M === 'POST') { store.resetPerson(sub); return send(res, 200, { ok: true }); }
    if (id === 'people' && sub && M === 'DELETE') { store.deletePerson(sub); return send(res, 200, { ok: true }); }

    // --- briefs (scoped under people for the console) ---
    if (id === 'people' && sub && arg === 'briefs' && M === 'GET') {
      return send(res, 200, store.listBriefsForPerson(sub).map((b) => ({
        id: b.id, status: b.status, createdAt: b.createdAt, updatedAt: b.updatedAt, sentAt: b.sentAt,
        docs: b.docs.length, question: b.facts?.question || null, packReady: !!b.pack,
      })));
    }
    // Full brief record for the console detail view
    if (id === 'briefs' && sub && M === 'GET') { const b = store.get(sub); if (!b) throw new HttpError(404, 'No such brief'); return send(res, 200, b); }
    if (id === 'briefs' && sub && M === 'DELETE') { store.remove(sub); return send(res, 200, { ok: true }); }
    // All briefs for an engagement
    if (id === 'engagements' && sub && arg === 'briefs' && M === 'GET') {
      return send(res, 200, store.listBriefsForEngagement(sub).map((b) => ({
        id: b.id, personId: b.personId, contact: b.contact, role: b.role, status: b.status,
        createdAt: b.createdAt, updatedAt: b.updatedAt, sentAt: b.sentAt,
        docs: b.docs.length, question: b.facts?.question || null, packReady: !!b.pack,
      })));
    }

    throw new HttpError(404, 'Not found');
  }

  if (first !== 'briefs') throw new HttpError(404, 'Not found');
  const b = store.get(id);
  if (!b) throw new HttpError(404, 'This brief link has expired or never existed');

  if (!sub && M === 'GET') return send(res, 200, clientView(b));

  if (sub === 'state' && M === 'PUT') {
    const x = await json(req, 4 * MB);
    let locked = false;
    // Checked inside the write, not before the body is read: an autosave in flight when Send lands must
    // not overwrite what was sent.
    store.update(id, (r) => { if (r.status === 'sent') { locked = true; return; } r.answers = x.answers ?? r.answers; r.facts = x.facts ?? r.facts; if (r.status === 'new') r.status = 'started'; });
    return send(res, 200, { ok: true, locked });
  }

  if (sub === 'docs' && M === 'POST') {
    const x = await json(req, 36 * MB);
    const bytes = Buffer.from(String(x.data || ''), 'base64');
    if (!bytes.length) throw new HttpError(400, 'Empty file');
    if (bytes.length > 25 * MB) throw new HttpError(413, "Files over 25 MB can\'t be read");
    if (b.docs.length >= 10) throw new HttpError(400, 'Ten documents is the limit');
    return send(res, 201, store.addDoc(id, { name: x.name || 'document', mime: x.mime || 'application/octet-stream', bytes }));
  }
  if (sub === 'docs' && arg && M === 'DELETE') { store.removeDoc(id, arg); return send(res, 200, { ok: true }); }
  if (sub === 'read' && M === 'POST') { const d = await gen.readDocs(id); return send(res, 200, { findings: d.findings || [] }); }

  if (sub === 'gen' && M === 'POST' && GEN[arg]) {
    const x = await json(req);
    if (x.facts) store.update(id, (r) => { if (r.status !== 'sent') r.facts = x.facts; });
    return send(res, 200, await GEN[arg](store.get(id), x));
  }

  if (sub === 'img' && M === 'GET') {
    if (!/^[a-f0-9]{16}$/.test(arg || '')) throw new HttpError(404, 'Not found');
    let path;
    try { path = await gen.awaitImage(id, arg); } catch { throw new HttpError(502, 'That image could not be made'); }
    if (!path) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Length': statSync(path).size });
    return createReadStream(path).on('error', () => res.destroy()).pipe(res);
  }

  if (sub === 'voice' && M === 'POST') {
    const x = await json(req, 256 * 1024);
    if (typeof x.sdp !== 'string' || !x.sdp.trim()) throw new HttpError(400, 'An SDP offer is needed');
    const s = await ai.voice.createSession({ sdp: x.sdp, instructions: gen.liveInstructions(b, x.facts || b.facts || {}) });
    return send(res, 201, s);
  }

  if (sub === 'transcribe' && M === 'POST') {
    const bytes = await body(req, 25 * MB);
    if (bytes.length < 800) return send(res, 200, { text: '' });
    const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0];
    const ext = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' }[mime] || 'webm';
    const text = await ai.transcribe.transcribe({ bytes, mime, filename: `speech.${ext}`, prompt: `${b.client}. ${b.contact}.` });
    return send(res, 200, { text });
  }

  if (sub === 'send' && M === 'POST') {
    const x = await json(req, 4 * MB);
    if (store.get(id).status === 'sent') return send(res, 200, { ok: true, already: true });
    store.update(id, (r) => { r.answers = x.answers ?? r.answers; r.facts = x.facts ?? r.facts; r.status = 'sent'; r.sentAt = new Date().toISOString(); r.pack = null; });
    makePack(id).catch((e) => console.error(`pack ${id}:`, e.message));
    return send(res, 200, { ok: true });
  }

  // Start again: create a new brief for the same person and engagement.
  if (sub === 'again' && M === 'POST') {
    if (!b.personId) throw new HttpError(400, 'This brief has no linked person');
    const nb = store.create({ personId: b.personId });
    if (!nb) throw new HttpError(500, 'Could not create a new brief');
    return send(res, 201, { id: nb.id });
  }

  if (sub === 'pack' && M === 'GET') {
    let cur = store.get(id);
    if (cur.status !== 'sent') throw new HttpError(409, "The brief hasn't been sent yet");
    if (!cur.pack) { await makePack(id); cur = store.get(id); }
    return send(res, 200, assemblePack(cur, url.searchParams.has('internal') && isStaff(req, url)));
  }

  throw new HttpError(404, 'Not found');
}

async function handle(req, res) {
  let url = null;
  try {
    // Parsed inside the try: a malformed Host header made this throw outside it and took the process down.
    url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/');
    if (parts[1] === 'api') return await api(req, res, url, parts);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');

    if (url.pathname === '/') {
      if (!isStaff(req, url)) return send(res, 403, 'This page is for Digital Labs.', 'text/plain; charset=utf-8');
      res.setHeader('Set-Cookie', staffCookie(url)['Set-Cookie'] || []);
      return page(res, 'console.html');
    }
    // /p/<personId> — the link you send a client. Resolves to their latest in-progress brief or creates one.
    if (parts[1] === 'p' && store.validPersonId(parts[2])) {
      const person = store.getPerson(parts[2]);
      if (!person) return send(res, 404, readFileSync(join(PUBLIC, 'missing.html')), TYPES['.html']);
      const b = store.resolvePersonBrief(person.id);
      // Redirect to the actual brief URL so the browser has a stable /b/<id> for API calls.
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
        // Chrome fetches the pack page from this same server; the internal render carries the token.
        const tok = internal && config.consoleToken ? `&token=${encodeURIComponent(config.consoleToken)}` : '';
        await printPDF(`http://127.0.0.1:${config.port}/b/${b.id}/pack?print=1${internal ? '&internal=1' : ''}${tok}`, out);
        const name = `${b.client} ${internal ? 'internal brief' : 'team pack'}.pdf`.replace(/[^\w .-]/g, '');
        return send(res, 200, readFileSync(out), 'application/pdf', { 'Content-Disposition': `${url.searchParams.has('dl') ? 'attachment' : 'inline'}; filename="${name}"` });
      }
    }
    // static assets under /assets/
    if (parts[1] === 'assets') {
      const p = join(PUBLIC, 'assets', ...parts.slice(2).filter((s) => s && s !== '..'));
      if (p.startsWith(join(PUBLIC, 'assets')) && existsSync(p) && statSync(p).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return createReadStream(p).on('error', () => res.destroy()).pipe(res);
      }
    }
    return send(res, 404, readFileSync(join(PUBLIC, 'missing.html')), TYPES['.html']);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 || e instanceof ProviderError) console.error(`${req.method} ${url?.pathname}:`, e.message);
    if (res.headersSent) return res.end();
    // Provider errors are logged, never passed on: an upstream 401 message carries a fragment of the key.
    const msg = e instanceof HttpError ? e.message : e instanceof ProviderError ? "The AI service couldn't do that just now" : 'Something went wrong';
    return send(res, e instanceof ProviderError ? 502 : status, { error: msg });
  }
}

createServer((req, res) => handle(req, res).catch((e) => { console.error('unhandled:', e); try { res.destroy(); } catch {} })).listen(config.port, config.host, () => {
  console.log(`Innovation Brief running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  // Where each capability sends its data, so a switched endpoint is visible at a glance.
  const host = (c) => { try { return new URL(c.baseURL).host; } catch { return c.baseURL; } };
  for (const [k, label] of [['text', 'text'], ['docs', 'docs'], ['image', 'image'], ['voice', 'voice'], ['transcribe', 'dictate']])
    console.log(`  ${label.padEnd(8)}${ai[k].name.padEnd(34)}${ai[k].name === 'none' ? '(off: no provider, or no key for this endpoint)' : `→ ${host(config[k])}`}`);
  if (!CHROME) console.log('  (no Chrome found: the pack downloads as a web page, not a PDF)');
});

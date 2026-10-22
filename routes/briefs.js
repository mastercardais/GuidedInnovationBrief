import { existsSync, statSync, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import * as store from '../lib/store.js';
import * as gen from '../lib/brief.js';
import { ai } from '../lib/providers/index.js';
import { HttpError } from '../lib/errors.js';
import { sanitizeFacts } from '../lib/guard.js';

/* ---------- upload MIME allowlist ---------- */
const ALLOWED_DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

/* ---------- per-brief rate limiter ----------
   Keyed by "<briefId>:<endpoint>". Resets each window. */
const rateMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = { gen: 30, read: 5, voice: 5, transcribe: 60 };

function checkRate(id, sub) {
  const limit = RATE_LIMITS[sub];
  if (!limit) return;
  const key = `${id}:${sub}`;
  const now = Date.now();
  let e = rateMap.get(key);
  if (!e || now - e.t > RATE_WINDOW_MS) { e = { t: now, n: 0 }; rateMap.set(key, e); }
  if (++e.n > limit) throw new HttpError(429, 'Too many requests — please wait a moment before trying again');
}

const clientView = (b) => ({
  id: b.id, personId: b.personId || null, client: b.client, contact: b.contact, role: b.role, status: b.status,
  docs: b.docs.map(({ id, name, size, mime }) => ({ id, name, size, mime })),
  findings: b.digest?.findings || null, answers: b.answers, sentAt: b.sentAt,
});

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

const norm = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
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

const GEN = Object.assign(Object.create(null), {
  frame: (b, x) => gen.frame(b, x.facts),
  question: (b, x) => gen.question(b, x.facts),
  photo: (b, x) => gen.photo(b, x.facts),
  story: (b, x) => gen.story(b, x.facts),
  directions: (b, x) => gen.directions(b, x.facts),
  regen: (b, x) => gen.regen(b, x.facts, x),
  chat: (b, x) => gen.chatTurn(b, x.facts, x.messages || []),
});

export { makePack, assemblePack, CHROME, printPDF };

export async function handleBriefs(req, res, url, parts, { send, json, body, isStaff, MB }) {
  const [, , , id, sub, arg] = parts;
  const M = req.method;

  const b = store.get(id);
  if (!b) throw new HttpError(404, 'This brief link has expired or never existed');

  if (!sub && M === 'GET') return send(res, 200, clientView(b));

  if (sub === 'state' && M === 'PUT') {
    const x = await json(req, 4 * MB);
    if (x.facts) x.facts = sanitizeFacts(x.facts);
    let locked = false;
    store.update(id, (r) => { if (r.status === 'sent') { locked = true; return; } r.answers = x.answers ?? r.answers; r.facts = x.facts ?? r.facts; if (r.status === 'new') r.status = 'started'; });
    return send(res, 200, { ok: true, locked });
  }

  if (sub === 'docs' && M === 'POST') {
    const x = await json(req, 36 * MB);
    const mime = (x.mime || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    if (!ALLOWED_DOC_MIME.has(mime)) throw new HttpError(400, 'That file type is not supported. Please upload PDF, Word, PowerPoint, or Excel files.');
    const bytes = Buffer.from(String(x.data || ''), 'base64');
    if (!bytes.length) throw new HttpError(400, 'Empty file');
    if (bytes.length > 25 * MB) throw new HttpError(413, "Files over 25 MB can't be read");
    if (b.docs.length >= 10) throw new HttpError(400, 'Ten documents is the limit');
    return send(res, 201, store.addDoc(id, { name: x.name || 'document', mime, bytes }));
  }
  if (sub === 'docs' && arg && M === 'DELETE') { store.removeDoc(id, arg); return send(res, 200, { ok: true }); }
  if (sub === 'read' && M === 'POST') { checkRate(id, 'read'); const d = await gen.readDocs(id); return send(res, 200, { findings: d.findings || [] }); }

  if (sub === 'gen' && M === 'POST' && GEN[arg]) {
    checkRate(id, 'gen');
    const x = await json(req);
    if (x.facts) store.update(id, (r) => { if (r.status !== 'sent') r.facts = x.facts; });
    const fresh = store.get(id);
    if (!fresh) throw new HttpError(404, 'This brief link has expired or never existed');
    return send(res, 200, await GEN[arg](fresh, x));
  }

  if (sub === 'img' && M === 'GET') {
    if (!/^[a-f0-9]{16}$/.test(arg || '')) throw new HttpError(404, 'Not found');
    let path;
    try { path = await gen.awaitImage(id, arg); } catch { throw new HttpError(502, 'That image could not be made'); }
    if (!path) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Content-Length': statSync(path).size });
    return createReadStream(path).on('error', () => res.destroy()).pipe(res);
  }

  if (sub === 'voice' && M === 'POST') {
    checkRate(id, 'voice');
    const x = await json(req, 256 * 1024);
    if (typeof x.sdp !== 'string' || !x.sdp.trim()) throw new HttpError(400, 'An SDP offer is needed');
    if (x.sdp.length > 16384) throw new HttpError(400, 'SDP offer is too large');
    const freshB = store.get(id) || b;
    const s = await ai.voice.createSession({ sdp: x.sdp, instructions: gen.liveInstructions(freshB, x.facts || freshB.facts || {}) });
    return send(res, 201, s);
  }

  if (sub === 'transcribe' && M === 'POST') {
    checkRate(id, 'transcribe');
    const bytes = await body(req, 25 * MB);
    if (bytes.length < 800) return send(res, 200, { text: '' });
    const mime = (req.headers['content-type'] || 'audio/webm').split(';')[0];
    const ext = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' }[mime] || 'webm';
    const text = await ai.transcribe.transcribe({ bytes, mime, filename: `speech.${ext}`, prompt: `${b.client}. ${b.contact}.` });
    return send(res, 200, { text });
  }

  if (sub === 'send' && M === 'POST') {
    const x = await json(req, 4 * MB);
    if (x.facts) x.facts = sanitizeFacts(x.facts);
    let alreadySent = false;
    store.update(id, (r) => {
      if (r.status === 'sent') { alreadySent = true; return; }
      r.answers = x.answers ?? r.answers; r.facts = x.facts ?? r.facts; r.status = 'sent'; r.sentAt = new Date().toISOString(); r.pack = null;
    });
    if (alreadySent) return send(res, 200, { ok: true, already: true });
    packJobs.delete(id); // drop any stale in-flight pack so it uses the facts just written
    makePack(id).catch((e) => console.error(`pack ${id}:`, e.message));
    return send(res, 200, { ok: true });
  }

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

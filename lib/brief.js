/* The generation steps. Each takes the brief record plus `facts`, a plain summary of the client's
   answers so far that the browser computes, and returns what the next screens need.

   Facts rather than the UI's own state, so the server never has to know how a screen stores its
   answers, and so every prompt sees the same picture of the client. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as store from './store.js';
import * as P from './prompts.js';
import { ai, ProviderError } from './providers/index.js';
import { sanitizeInput, sanitizeOutputObj } from './guard.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
// The story is set two years out (Jon, 21 Sep): far enough to have worked, near enough to feel real.
export const storyWhen = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 24); return monthYear(d); };

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const q = (s) => `"${String(s).trim()}"`;
const bullets = (xs) => xs.filter(Boolean).map((x) => `- ${x}`).join('\n');

/* One readable picture of everything we know, shared by every prompt.
   Every field is capped before joining to bound prompt size and limit token-cost inflation. */
export function context(b, f = {}) {
  const cap = (s, n) => String(s || '').slice(0, n);
  const capArr = (a, itemLen, maxItems) => (Array.isArray(a) ? a : []).slice(0, maxItems).map((x) => cap(x, itemLen));
  const out = [];
  out.push(`Client organisation: ${cap(b.client, 200)}.`);
  out.push(`The person answering: ${cap(b.contact, 200)}${b.role ? `, ${cap(b.role, 200)}` : ''}.`);
  out.push(`Today: ${monthYear(new Date())}.`);
  if (f.docs !== false && b.digest?.summary) out.push(`What their own documents say (${b.docs.length} uploaded):\n${cap(b.digest.summary, 8000)}`);
  if (f.findings?.length) out.push(`What stood out in the documents, as the client corrected it:\n${bullets(capArr(f.findings, 500, 20))}`);
  // sanitizeInput: PII redaction + copyright + toxicity check on all free-text fields
  if (f.dump?.trim()) out.push(`In their own words, typed:\n${q(sanitizeInput(f.dump.trim().slice(0, 6000)))}`);
  if (f.transcript?.length) out.push(`A short call with them, transcribed (may contain transcription errors):\n${f.transcript.slice(-60).map((m) => `${m.who === 'client' ? 'Client' : 'Interviewer'}: ${sanitizeInput(cap(m.text, 1000))}`).join('\n').slice(0, 8000)}`);
  if (f.customer) out.push(`Who it's about, in their words: ${sanitizeInput(cap(f.customer, 500))}`);
  if (f.changes?.length) out.push(`What changes for those customers if it works (they ticked):\n${bullets(capArr(f.changes, 300, 10))}`);
  if (f.confidence?.some((c) => c.band)) out.push(`How sure they are:\n${bullets(f.confidence.slice(0, 20).filter((c) => c.band).map((c) => `${cap(c.text, 300)} (${cap(c.band, 50)})`))}`);
  if (f.question) out.push(`The question they picked as their challenge: ${sanitizeInput(cap(f.question, 500))}`);
  if (f.businessValue?.picked?.length) out.push(`Business value they selected and prioritized:\n${bullets(capArr(f.businessValue.picked, 300, 10).map((w) => w === f.businessValue.priority ? `${w} (highest priority)` : w))}`);
  if (f.worth) out.push(`What solving it is worth, roughly: ${cap(f.worth, 200)}`);
  if (f.concerns?.picked?.length) out.push(`What worries them:\n${bullets(capArr(f.concerns.picked, 300, 10).map((c) => c === f.concerns.biggest ? `${c} (their biggest worry)` : c))}`);
  const d = f.directions;
  if (d && (d.loved?.length || d.maybe?.length || d.no?.length)) out.push(`Their reactions to early directions: loved ${capArr(d.loved, 200, 10).join(', ') || 'none'}; maybe ${capArr(d.maybe, 200, 10).join(', ') || 'none'}; not for us ${capArr(d.no, 200, 10).join(', ') || 'none'}.${d.own?.length ? ` Their own ideas: ${capArr(d.own, 200, 5).join(', ')}.` : ''}`);
  if (f.anythingElse?.trim()) out.push(`Anything else they wanted us to know: ${q(sanitizeInput(f.anythingElse.trim().slice(0, 3000)))}`);
  if (out.length < 4) out.push('They have not told us much yet. Write things they can react to, not things that pretend to be known.');
  return out.join('\n\n');
}

/* Strict providers enforce the schema; `chat` and sometimes `gemini` don't, and a short list would put a
   blank option on screen. So every reply is checked against its schema's array lengths and required
   strings, and a bad one is an error the client can retry, not a screen with holes in it. */
function check(v, schema, path = 'reply') {
  if (schema.type === 'string') { if (typeof v !== 'string' || !v.trim()) throw new ProviderError('Text generation', 502, `${path} is empty`); return; }
  if (schema.type === 'boolean') { if (typeof v !== 'boolean') throw new ProviderError('Text generation', 502, `${path} is not true/false`); return; }
  if (schema.type === 'array') {
    if (!Array.isArray(v) || (schema.minItems && v.length < schema.minItems)) throw new ProviderError('Text generation', 502, `${path} has too few items`);
    v.forEach((x, i) => check(x, schema.items, `${path}[${i}]`)); return;
  }
  if (schema.type === 'object') { if (!v || typeof v !== 'object') throw new ProviderError('Text generation', 502, `${path} is missing`); for (const k of schema.required || []) check(v[k], schema.properties[k], `${path}.${k}`); }
}
const run = async (spec, b, facts, extra = {}) => {
  const r = await ai.text.json({ system: spec.system, user: spec.user(context(b, facts), extra), schema: spec.schema, name: spec.name });
  check(r, spec.schema, spec.name);
  return sanitizeOutputObj(r);
};

/* ---------- documents ----------
   Reading documents and writing the pack go to the docs slot. If that provider is down or overloaded
   (Gemini returned 503s for most of 21 Sep), the text slot tries instead, so the client never waits on
   one vendor's bad afternoon, or on a typo in its config. A refusal (422) or a malformed request (400)
   isn't retried: another model won't fix those. */
async function careful(args) {
  try { return await ai.docs.json(args); }
  catch (e) {
    if (ai.docs.name === ai.text.name || e.status === 400 || e.status === 422) throw e;
    console.warn(`docs provider ${ai.docs.name} failed (${e.message}); using ${ai.text.name}`);
    return ai.text.json(args);
  }
}

const inflight = new Map();
const once = (key, fn) => {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
};
const docsKey = (b) => b.docs.map((d) => d.id).sort().join(',');

export function readDocs(id) {
  return once(`digest:${id}`, async () => {
    const b = store.get(id);
    if (!b.docs.length) return { findings: [] };
    const key = docsKey(b);
    if (b.digest?.key === key) return b.digest;
    const files = b.docs.map((d) => ({ name: d.name, mime: d.mime || 'application/octet-stream', base64: store.readDoc(id, d).toString('base64') }));
    const r = await careful({ system: P.digest.system, user: P.digest.user(context(b, {})), files, schema: P.digest.schema, name: 'digest' });
    const digest = { key, summary: r.summary, findings: r.findings };
    store.update(id, (x) => { if (docsKey(x) === key) x.digest = digest; });
    return digest;
  });
}

/* ---------- the stages ---------- */
export const frame = (b, facts) => run(P.frame, b, facts);
export async function question(b, facts) {
  const parts = await Promise.all(Object.values(P.question).map((spec) => run(spec, b, facts)));
  return Object.assign({}, ...parts);
}

// Start the photo as soon as the discovery call ends, while the client works through the brief.
// Its prompt uses the call transcript and the same editorial photo is reused for the press story.
const earlyPhotos = new Map(); // briefId → image key
export async function photo(b, facts) {
  if (ai.image.name === 'none') return { image: null };
  const prev = earlyPhotos.get(b.id);
  if (prev) return { image: prev };
  const r = await run(P.earlyPhoto, b, facts);
  const key = startImage(b.id, P.photoPrompt(r.photo), '1024x1024');
  earlyPhotos.set(b.id, key);
  return { image: key };
}

export async function story(b, facts) {
  const when = storyWhen();
  const s = await run(P.story, b, facts, { when });
  s.when = when;
  // Reuse the image started after the call; generate at the story stage only as a fallback.
  const early = earlyPhotos.get(b.id);
  if (early) {
    s.image = early;
  } else {
    s.image = startImage(b.id, P.photoPrompt(s.photo), '1024x1024');
  }
  return s;
}

export async function directions(b, facts) {
  const r = await run(P.directions, b, facts);
  return r.directions.map((d) => ({ title: d.title, line: d.line, image: startImage(b.id, P.boardPrompt(d.board), '1024x1024') }));
}

export async function regen(b, facts, { kind, current, others = [] }) {
  if (kind === 'direction') {
    const d = await run(P.direction, b, facts, { current, others });
    return { title: d.title, line: d.line, image: startImage(b.id, P.boardPrompt(d.board), '1024x1024') };
  }
  if (!P.REGEN_KINDS.includes(kind)) throw new ProviderError('Regenerate', 400, `unknown kind ${kind}`);
  const r = await run(P.regen, b, facts, { kind, current, others });
  return { text: r.text };
}

export const chatTurn = async (b, facts, messages) => {
  const history = messages.slice(-24).map((m) => `${m.who === 'client' ? 'Client' : 'You'}: ${sanitizeInput(String(m.text || '').slice(0, 1000))}`).join('\n');
  const r = await ai.text.json({
    system: P.chat.system, schema: P.chat.schema, name: 'chat',
    user: `${context(b, facts)}\n\nThe conversation so far:\n${history || '(nothing yet: open the conversation. Greet them by first name and ask what\'s going on, in whatever order it comes out.)'}\n\nWrite your next turn.`,
  });
  return sanitizeOutputObj(r);
};

export const packCopy = (b, facts) => careful({ system: P.pack.system, user: P.pack.user(context(b, facts)), schema: P.pack.schema, name: P.pack.name }).then(sanitizeOutputObj);

export const liveInstructions = (b, facts) =>
  P.liveInstructions({ client: b.client, contact: firstName(b.contact), ctx: context(b, facts) });

/* ---------- images ----------
   Generated in the background: the text comes back straight away with an image key, and the browser
   loads /img/<key> which waits for the painting if it's still in progress. Keyed by prompt, so the
   same prompt is never painted twice. */
const jobs = new Map();
export function startImage(id, prompt, size) {
  if (ai.image.name === 'none') return null;
  const key = createHash('sha1').update(`${size}|${prompt}`).digest('hex').slice(0, 16);
  if (existsSync(store.imgPath(id, key)) || jobs.has(`${id}/${key}`)) return key;
  // The prompt is kept beside the image, so one lost to a restart mid-paint can be painted again.
  mkdirSync(store.dir(id, 'img'), { recursive: true });
  writeFileSync(store.imgPath(id, key).replace(/\.jpg$/, '.json'), JSON.stringify({ prompt, size }));
  const job = ai.image.generate({ prompt, size })
    .then(({ bytes }) => store.writeImg(id, key, bytes))
    .catch((e) => {
      console.error(`image ${key}:`, e.message);
      // A refusal won't change on a retry, so remember it and never pay to paint it again.
      if (e.status === 400) writeFileSync(store.imgPath(id, key).replace(/\.jpg$/, '.json'), JSON.stringify({ prompt, size, refused: true }));
      throw e;
    })
    .finally(() => setTimeout(() => jobs.delete(`${id}/${key}`), 60_000)); // keep the failure visible for a minute
  job.catch(() => {});
  jobs.set(`${id}/${key}`, job);
  return key;
}
export async function awaitImage(id, key) {
  const path = store.imgPath(id, key);
  if (existsSync(path)) return path;
  let job = jobs.get(`${id}/${key}`);
  if (!job) {
    const meta = store.imgPath(id, key).replace(/\.jpg$/, '.json');
    if (!existsSync(meta)) return null;
    const { prompt, size, refused } = JSON.parse(readFileSync(meta, 'utf8'));
    if (refused) return null;
    startImage(id, prompt, size);
    job = jobs.get(`${id}/${key}`);
  }
  await job;
  return path;
}

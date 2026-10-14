/* Briefs on disk, one folder each: brief.json, the uploaded documents and the generated images.
   Clients, engagements and people live in a single meta.json beside the brief folders.
   Plain files on purpose, so everything can be read, copied or deleted by hand. Swap this module for a
   database when it needs to run on more than one machine. */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

const BRIEFS = join(config.dataDir, 'briefs');
mkdirSync(BRIEFS, { recursive: true });

const ID = /^[A-Za-z0-9_-]{10,40}$/;
export const validId = (id) => ID.test(id || '');
export const dir = (id, ...p) => join(BRIEFS, id, ...p);

// The link is the only key a client has, so it has to be unguessable.
const newId = () => randomBytes(12).toString('base64url');
const shortId = () => randomBytes(8).toString('base64url');

function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/* ---------- meta: clients, engagements, people ----------
   One file, loaded into memory on boot, written back on every change. Small enough to stay in memory
   forever — even 500 engagements is a few KB. */
const META_PATH = join(config.dataDir, 'meta.json');
let meta = { clients: [], engagements: [], people: [] };

function loadMeta() {
  if (existsSync(META_PATH)) {
    try { meta = JSON.parse(readFileSync(META_PATH, 'utf8')); } catch { /* corrupt file, start fresh */ }
  }
  // Ensure arrays exist (in case of partial file)
  meta.clients = meta.clients || [];
  meta.engagements = meta.engagements || [];
  meta.people = meta.people || [];
}
loadMeta();

function saveMeta() {
  mkdirSync(config.dataDir, { recursive: true });
  writeAtomic(META_PATH, JSON.stringify(meta, null, 2));
}

/* --- clients --- */
export function createClient({ name }) {
  const c = { id: shortId(), name: name.slice(0, 120), createdAt: new Date().toISOString() };
  meta.clients.push(c);
  saveMeta();
  return c;
}
export function getClient(id) { return meta.clients.find((c) => c.id === id) || null; }
export function listClients() { return meta.clients.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function deleteClient(id) {
  // Cascade: remove engagements, people and their briefs
  const engIds = meta.engagements.filter((e) => e.clientId === id).map((e) => e.id);
  engIds.forEach(deleteEngagement);
  meta.clients = meta.clients.filter((c) => c.id !== id);
  saveMeta();
}

/* --- engagements --- */
export function createEngagement({ clientId, name }) {
  const client = getClient(clientId);
  if (!client) return null;
  const e = { id: shortId(), clientId, name: name.slice(0, 200), createdAt: new Date().toISOString() };
  meta.engagements.push(e);
  saveMeta();
  return e;
}
export function getEngagement(id) { return meta.engagements.find((e) => e.id === id) || null; }
export function listEngagements(clientId) {
  return meta.engagements.filter((e) => e.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function deleteEngagement(id) {
  const personIds = meta.people.filter((p) => p.engagementId === id).map((p) => p.id);
  personIds.forEach(deletePerson);
  meta.engagements = meta.engagements.filter((e) => e.id !== id);
  saveMeta();
}

/* --- people --- */
export function createPerson({ engagementId, name, email, role = '', sponsor = false }) {
  const eng = getEngagement(engagementId);
  if (!eng) return null;
  const p = { id: shortId(), engagementId, name: name.slice(0, 120), email: (email || '').slice(0, 200), role: role.slice(0, 120), sponsor, createdAt: new Date().toISOString() };
  meta.people.push(p);
  saveMeta();
  return p;
}
export function getPerson(id) { return meta.people.find((p) => p.id === id) || null; }
export function listPeople(engagementId) {
  return meta.people.filter((p) => p.engagementId === engagementId).sort((a, b) => a.name.localeCompare(b.name));
}
export function updatePerson(id, fields) {
  const p = getPerson(id);
  if (!p) return null;
  if (fields.name != null) p.name = String(fields.name).slice(0, 120);
  if (fields.email != null) p.email = String(fields.email).slice(0, 200);
  if (fields.role != null) p.role = String(fields.role).slice(0, 120);
  if (fields.sponsor != null) p.sponsor = !!fields.sponsor;
  saveMeta();
  return p;
}
export function deletePerson(id) {
  // Remove all briefs for this person
  listBriefsForPerson(id).forEach((b) => remove(b.id));
  meta.people = meta.people.filter((p) => p.id !== id);
  saveMeta();
}
export function resetPerson(id) {
  // Delete all briefs but keep the person — returns them to "not started"
  listBriefsForPerson(id).forEach((b) => remove(b.id));
}
export const validPersonId = (id) => /^[A-Za-z0-9_-]{6,40}$/.test(id || '');

/* ---------- briefs ---------- */
export function create({ personId }) {
  const person = getPerson(personId);
  if (!person) return null;
  const eng = getEngagement(person.engagementId);
  const client = eng ? getClient(eng.clientId) : null;
  const id = newId();
  mkdirSync(dir(id, 'docs'), { recursive: true });
  mkdirSync(dir(id, 'img'), { recursive: true });
  const b = {
    id, personId, engagementId: person.engagementId,
    client: client?.name || '', contact: person.name, role: person.role || '',
    status: 'new', createdAt: new Date().toISOString(),
    docs: [], digest: null, answers: null, facts: null, pack: null, sentAt: null,
  };
  save(b);
  return b;
}

export function get(id) {
  if (!validId(id)) return null;
  const p = dir(id, 'brief.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function save(b) {
  b.updatedAt = new Date().toISOString();
  writeAtomic(dir(b.id, 'brief.json'), JSON.stringify(b, null, 2));
  return b;
}

export function update(id, fn) {
  const b = get(id);
  if (!b) return null;
  fn(b);
  return save(b);
}

export function list() {
  return readdirSync(BRIEFS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && validId(d.name))
    .map((d) => get(d.name)).filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listBriefsForPerson(personId) {
  return list().filter((b) => b.personId === personId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listBriefsForEngagement(engagementId) {
  return list().filter((b) => b.engagementId === engagementId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The person's link resolves to their latest in-progress brief, or creates a new one.
export function resolvePersonBrief(personId) {
  const briefs = listBriefsForPerson(personId);
  const active = briefs.find((b) => b.status !== 'sent');
  if (active) return active;
  return create({ personId });
}

export function remove(id) {
  if (validId(id)) rmSync(dir(id), { recursive: true, force: true });
}

/* documents */
const safeName = (n) => String(n).replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'document';
export function addDoc(id, { name, mime, bytes }) {
  const b = get(id);
  const docId = randomBytes(6).toString('hex');
  const file = `${docId}-${safeName(name)}`;
  writeFileSync(dir(id, 'docs', file), bytes);
  const doc = { id: docId, name: String(name).slice(0, 200), mime, size: bytes.length, file };
  b.docs.push(doc);
  b.digest = null; // the set of documents changed, so the old reading no longer stands
  save(b);
  return doc;
}
export function removeDoc(id, docId) {
  update(id, (b) => {
    const d = b.docs.find((x) => x.id === docId);
    if (d) rmSync(dir(id, 'docs', d.file), { force: true });
    b.docs = b.docs.filter((x) => x.id !== docId);
    b.digest = null;
  });
}
export const readDoc = (id, d) => readFileSync(dir(id, 'docs', d.file));

/* images */
export const imgPath = (id, key) => dir(id, 'img', `${key}.jpg`);
export const writeImg = (id, key, bytes) => { mkdirSync(dir(id, 'img'), { recursive: true }); writeAtomic(imgPath(id, key), bytes); };

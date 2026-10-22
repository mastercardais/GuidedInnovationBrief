import * as store from '../lib/store.js';
import { HttpError } from '../lib/errors.js';

// Strip verbatim client speech from brief before returning it to the admin UI.
// The full facts object (dump, transcript, anythingElse) is the most sensitive
// personal data in the system — it should not be transmitted unless explicitly
// requested and the access logged for audit purposes.
function adminBriefView(b) {
  if (!b) return null;
  const { facts, answers, digest, ...meta } = b;
  return {
    ...meta,
    docs: b.docs?.length ?? 0,
    // Structured fields only — no verbatim text
    facts: facts ? {
      question: facts.question || null,
      customer: facts.customer || null,
      changes: facts.changes || [],
      businessValue: facts.businessValue || null,
      confidence: facts.confidence || [],
      concerns: facts.concerns || null,
      story: facts.story || null,
      directions: facts.directions || null,
      // omitted: dump, transcript, anythingElse (verbatim free text)
    } : null,
    answersPresent: !!answers,
    digestPresent: !!(digest?.summary),
  };
}

export async function handleAdmin(req, res, url, parts, { send, json, isStaff }) {
  const [, , , id, sub, arg] = parts;
  const M = req.method;

  if (!isStaff(req, url)) throw new HttpError(403, 'Not allowed');

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

  if (id === 'clients' && !sub && M === 'GET') return send(res, 200, store.listClients());
  if (id === 'clients' && !sub && M === 'POST') {
    const x = await json(req);
    const name = String(x.name || '').trim();
    if (!name) throw new HttpError(400, 'Client name is required');
    return send(res, 201, store.createClient({ name }));
  }
  if (id === 'clients' && sub && M === 'DELETE') { store.deleteClient(sub); return send(res, 200, { ok: true }); }

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

  if (id === 'people' && sub && arg === 'briefs' && M === 'GET') {
    return send(res, 200, store.listBriefsForPerson(sub).map((b) => ({
      id: b.id, status: b.status, createdAt: b.createdAt, updatedAt: b.updatedAt, sentAt: b.sentAt,
      docs: b.docs.length, question: b.facts?.question || null, packReady: !!b.pack,
    })));
  }
  if (id === 'briefs' && sub && M === 'GET') {
    const b = store.get(sub);
    if (!b) throw new HttpError(404, 'No such brief');
    return send(res, 200, adminBriefView(b));
  }
  if (id === 'briefs' && sub && M === 'DELETE') { store.remove(sub); return send(res, 200, { ok: true }); }
  if (id === 'engagements' && sub && arg === 'briefs' && M === 'GET') {
    return send(res, 200, store.listBriefsForEngagement(sub).map((b) => ({
      id: b.id, personId: b.personId, contact: b.contact, role: b.role, status: b.status,
      createdAt: b.createdAt, updatedAt: b.updatedAt, sentAt: b.sentAt,
      docs: b.docs.length, question: b.facts?.question || null, packReady: !!b.pack,
    })));
  }

  // POST /api/console/purge  { before: "2025-01-01" }
  // Deletes all briefs (and their docs/images) whose sentAt (or createdAt for unsent)
  // is before the given ISO date. Implements the data retention policy (C1).
  if (id === 'purge' && M === 'POST') {
    const x = await json(req);
    const cutoff = x.before ? new Date(x.before) : null;
    if (!cutoff || isNaN(cutoff)) throw new HttpError(400, '"before" must be a valid ISO date, e.g. "2025-01-01"');
    const all = store.list();
    const toDelete = all.filter((b) => {
      const ref = new Date(b.sentAt || b.createdAt);
      return ref < cutoff;
    });
    toDelete.forEach((b) => store.remove(b.id));
    return send(res, 200, { deleted: toDelete.length, before: cutoff.toISOString() });
  }

  // POST /api/console/erasure  { email: "jane@example.com" }
  // Finds all people records with the given email and hard-deletes them along with
  // their briefs and documents. Supports right-to-erasure requests (H4 / GDPR Art. 17).
  if (id === 'erasure' && M === 'POST') {
    const x = await json(req);
    const email = String(x.email || '').trim().toLowerCase();
    if (!email) throw new HttpError(400, '"email" is required');
    const matched = store.listAllPeople().filter((p) => p.email.toLowerCase() === email);
    matched.forEach((p) => store.deletePerson(p.id));
    return send(res, 200, { erased: matched.length, email });
  }

  throw new HttpError(404, 'Not found');
}

import * as store from '../lib/store.js';
import { HttpError } from '../lib/errors.js';

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
  if (id === 'briefs' && sub && M === 'GET') { const b = store.get(sub); if (!b) throw new HttpError(404, 'No such brief'); return send(res, 200, b); }
  if (id === 'briefs' && sub && M === 'DELETE') { store.remove(sub); return send(res, 200, { ok: true }); }
  if (id === 'engagements' && sub && arg === 'briefs' && M === 'GET') {
    return send(res, 200, store.listBriefsForEngagement(sub).map((b) => ({
      id: b.id, personId: b.personId, contact: b.contact, role: b.role, status: b.status,
      createdAt: b.createdAt, updatedAt: b.updatedAt, sentAt: b.sentAt,
      docs: b.docs.length, question: b.facts?.question || null, packReady: !!b.pack,
    })));
  }

  throw new HttpError(404, 'Not found');
}

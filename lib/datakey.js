/* AES-256-GCM field-level encryption for sensitive data at rest (H3).
   Encrypts the `facts`, `answers`, and `digest` fields in brief.json —
   the fields that contain verbatim client speech, transcripts, and
   extracted document content.

   Key is a 64-char hex string (32 bytes) from DATA_ENCRYPTION_KEY in .env.
   If the key is not set, a warning is logged once and data is stored in plaintext.

   Encrypted fields are stored as: { _enc: 'aes-256-gcm', _iv: '<hex>', _tag: '<hex>', _ct: '<hex>' }
   On read, that shape is detected and decrypted transparently.
   Plaintext objects (existing briefs, unset key) are returned as-is so migration is seamless. */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

const ALGO = 'aes-256-gcm';
let _key = null;
let _warned = false;

function getKey() {
  if (_key) return _key;
  const hex = config.dataEncryptionKey;
  if (!hex) {
    if (!_warned) {
      console.warn(
        'WARNING: DATA_ENCRYPTION_KEY is not set. Sensitive brief fields (facts, answers, digest) ' +
        'are stored in plaintext. Set a 64-char hex key in .env to enable encryption at rest.'
      );
      _warned = true;
    }
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('DATA_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  }
  _key = Buffer.from(hex, 'hex');
  return _key;
}

export function encryptField(obj) {
  if (obj === null || obj === undefined) return obj;
  const key = getKey();
  if (!key) return obj; // no key — store plaintext
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { _enc: ALGO, _iv: iv.toString('hex'), _tag: tag.toString('hex'), _ct: ct.toString('hex') };
}

export function decryptField(val) {
  if (!val || typeof val !== 'object' || val._enc !== ALGO) return val;
  const key = getKey();
  if (!key) throw new Error('DATA_ENCRYPTION_KEY is required to read this brief — the field is encrypted.');
  const decipher = createDecipheriv(ALGO, key, Buffer.from(val._iv, 'hex'));
  decipher.setAuthTag(Buffer.from(val._tag, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(val._ct, 'hex')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

// Apply to a brief object before writing to disk.
export function encryptBrief(b) {
  return { ...b, facts: encryptField(b.facts), answers: encryptField(b.answers), digest: encryptField(b.digest) };
}

// Apply to a brief object after reading from disk.
export function decryptBrief(b) {
  return { ...b, facts: decryptField(b.facts), answers: decryptField(b.answers), digest: decryptField(b.digest) };
}

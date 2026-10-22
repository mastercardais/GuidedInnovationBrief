/* Every model, endpoint and key the app uses, in one place.

   Each capability (text, image, voice, transcribe) is configured on its own, so they can come from
   different vendors: text from one provider, images from another, voice switched off. Set them in
   app/.env (see .env.example). Nothing here is read by the browser. */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/(^|\s+)#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

// Precedence: the real environment, then app/.env. Nothing else.
const local = parseEnv(join(ROOT, '.env'));
const env = (k, d) => process.env[k] ?? local[k] ?? d;
const pick = (...ks) => { for (const k of ks) { const v = process.env[k] || local[k]; if (v) return v; } return ''; };

/* The one switch. AI_BASE_URL and AI_API_KEY are what every slot uses unless it names its own. */
const BASE = env('AI_BASE_URL', '').replace(/\/+$/, '');
const base = (P) => env(`${P}_BASE_URL`, BASE).replace(/\/+$/, '');
const key = (P) => pick(`${P}_API_KEY`, 'AI_API_KEY');

function textSlot(P, d) {
  const provider = env(`${P}_PROVIDER`, d.provider);
  return {
    provider,
    model: env(`${P}_MODEL`, d.model),
    baseURL: base(P),
    apiKey: key(P),
    fallbackKey: '',
    reasoning: env(`${P}_REASONING`, 'medium'),          // openai only: none | low | medium | high
  };
}

export const config = {
  port: +env('PORT', 3000),
  host: env('HOST', '127.0.0.1'),
  dataDir: env('DATA_DIR', join(ROOT, 'data')),
  // Where the Digital Labs console lives. Leave empty to leave it open (local use only).
  consoleToken: env('CONSOLE_TOKEN', ''),
  // Brief links expire after this many days (0 = never). Supports data minimisation (M2).
  briefExpiryDays: +env('BRIEF_EXPIRY_DAYS', 90),
  // 32-byte hex key for AES-256-GCM encryption of sensitive fields at rest (H3).
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // If unset, sensitive fields are stored in plaintext — not recommended for production.
  dataEncryptionKey: env('DATA_ENCRYPTION_KEY', ''),

  // Every option, question and follow-up the client sees: fast, and called often.
  text: textSlot('AI_TEXT', { provider: 'openai', model: 'gpt-5.6-luna' }),   // openai | chat | gemini
  // Reading the client's documents, and writing the pack once the brief is sent: one-off calls where
  // quality beats speed. gpt-5.6-terra won the document bake-off (scripts/bench-docs.js, 21 Sep): 15-16 of
  // 18 facts in about 6s, against 11-13 for luna and Gemini Flash. If it fails, the text slot takes over.
  docs: textSlot('AI_DOCS', { provider: 'openai', model: 'gpt-5.6-terra' }),  // openai | chat | gemini
  image: {
    provider: env('AI_IMAGE_PROVIDER', 'openai'),       // openai | none
    model: env('AI_IMAGE_MODEL', 'gpt-image-2.5-flare'),
    baseURL: base('AI_IMAGE'),
    apiKey: key('AI_IMAGE'),
    quality: env('AI_IMAGE_QUALITY', 'low'),            // low | medium | high
  },
  voice: {
    provider: env('AI_VOICE_PROVIDER', 'openai-live'),  // openai-live | none (falls back to a typed chat)
    model: env('AI_VOICE_MODEL', 'gpt-live-1'),
    baseURL: base('AI_VOICE'),
    apiKey: key('AI_VOICE'),
    voice: env('AI_VOICE_VOICE', 'quartz'),             // quartz is Australian English
  },
  transcribe: {
    provider: env('AI_TRANSCRIBE_PROVIDER', 'openai'),  // openai (any /audio/transcriptions endpoint) | none
    model: env('AI_TRANSCRIBE_MODEL', 'gpt-transcribe'),
    baseURL: base('AI_TRANSCRIBE'),
    apiKey: key('AI_TRANSCRIBE'),
  },
};

// What the browser is allowed to know: which features are on, never keys or URLs.
export const publicConfig = () => ({
  voice: config.voice.provider !== 'none' && !!config.voice.apiKey,
  images: config.image.provider !== 'none' && !!config.image.apiKey,
  dictation: config.transcribe.provider !== 'none' && !!config.transcribe.apiKey,
});

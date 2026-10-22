/* Content safety guards applied to all AI input and output.
   Mirrors content_guard.py — four areas:
     1. Copyright  — block requests to reproduce protected works verbatim
     2. PII        — detect and redact before text reaches the LLM; audit every hit
     3. Toxicity   — reject harmful / hateful content in both directions
     4. Bias       — block AI output that contains demographic stereotyping

   Input violations throw HttpError (→ 400 to the client).
   Output violations throw ProviderError (→ 502, masked to the client). */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { ProviderError } from './providers/index.js';

// ── Audit log ──────────────────────────────────────────────────────────────────
// One JSONL record per event. No raw text is ever stored — only the pattern name
// and whether it was in input or output. Required for AI governance audit trails.

const AUDIT_DIR = join(config.dataDir, 'audit');
const AUDIT_PATH = join(AUDIT_DIR, 'guard_events.jsonl');

function logEvent(event, pattern, context = '') {
  const record = JSON.stringify({
    ts: new Date().toISOString(),
    event,    // "redacted" | "blocked" | "intent_blocked"
    pattern,  // e.g. "email", "IBAN", "toxic_input", "bias_output"
    context,  // "input" | "output" — no actual text stored
  });
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(AUDIT_PATH, record + '\n');
  } catch (e) {
    console.warn('guard audit log write failed:', e.message);
  }
}

// ── 1. Copyright ───────────────────────────────────────────────────────────────

const COPYRIGHT = /\b(reproduce\s+(the\s+)?full\s+(text|lyrics|content|article|book|chapter|script|poem)|copy\s+(the\s+)?full\s+(text|lyrics|content|article|book|chapter|script|poem)|verbatim\s+(copy|reproduction|extract|quote)|copy(right)?\s+infring|reproduce\s+word[\s-]for[\s-]word|give\s+me\s+the\s+(full|entire|complete|whole)\s+(lyrics|text|article|book|chapter|script|poem)|write\s+out\s+the\s+(full|entire|complete)\s+(lyrics|text|article|book|chapter|script|poem))\b/i;

function checkCopyright(text) {
  if (COPYRIGHT.test(text)) {
    logEvent('blocked', 'copyright', 'input');
    throw new HttpError(400,
      'Your request appears to ask for verbatim reproduction of copyright-protected content. ' +
      'Please rephrase to ask for a summary, paraphrase, or original creative work instead.');
  }
}

// ── 2. PII detection & redaction ──────────────────────────────────────────────
// Each entry: [regex-with-g, replacement, pattern-name-for-audit]
// Patterns cover AU, US/CA, international, Korean, and financial identifiers.

const PII_PATTERNS = [
  // Email
  [/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
   '[email redacted]', 'email'],

  // AU mobile: 04XX XXX XXX (local) or +61 4XX XXX XXX (international, leading 0 dropped)
  [/(?<!\d)(?:\+?61[\s-]?4\d{2}[\s-]?\d{3}[\s-]?\d{3}|04\d{2}[\s-]?\d{3}[\s-]?\d{3})(?!\d)/g,
   '[phone redacted]', 'phone_AU_mobile'],

  // AU landline: (0X) XXXX XXXX
  [/(?<!\d)\(0[2-9]\)[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
   '[phone redacted]', 'phone_AU_landline'],

  // US / CA: (XXX) XXX-XXXX or XXX-XXX-XXXX (requires at least one separator)
  [/(?<!\d)(?:\+?1[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}(?!\d)/g,
   '[phone redacted]', 'phone_US'],

  // Generic international: +CC (optional) + digit groups totalling 7–12 digits
  [/(?<!\d)\+\d{1,3}[\s-]\(?\d{1,4}\)?[\s-]\d{3,5}[\s-]\d{3,5}(?!\d)/g,
   '[phone redacted]', 'phone_intl'],

  // US SSN: XXX-XX-XXXX (hyphens required to avoid false positives)
  [/\b\d{3}-\d{2}-\d{4}\b/g,
   '[SSN redacted]', 'SSN'],

  // AU Tax File Number: 9 digits with optional spaces/hyphens (groups of 3)
  [/\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/g,
   '[TFN redacted]', 'TFN'],

  // Passport — generic: 1–2 uppercase letters + 6–9 digits
  [/\b[A-Z]{1,2}\d{6,9}\b/g,
   '[passport redacted]', 'passport'],

  // Date of birth — dd/mm/yyyy or dd-mm-yyyy or yyyy-mm-dd
  [/\b(?:0?[1-9]|[12]\d|3[01])[/\-.] *(?:0?[1-9]|1[0-2])[/\-.]\d{2,4}\b|\b\d{4}[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])\b/g,
   '[DOB redacted]', 'DOB'],

  // IBAN: 2-letter CC + 2 check digits + 11–30 alphanumeric chars
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\s?[A-Z0-9]{1,4}\b/g,
   '[IBAN redacted]', 'IBAN'],

  // AU BSB (XXX-XXX) + account (6–10 digits)
  [/\b\d{3}-\d{3}[\s-]+\d{6,10}\b/g,
   '[BSB/account redacted]', 'BSB_account'],

  // US routing (9 digits) + account (5–17 digits), separated
  [/\b\d{9}[\s-]+\d{5,17}\b/g,
   '[routing/account redacted]', 'routing_account'],

  // Korean mobile: 010/011/016/017/018/019-XXXX-XXXX
  [/\b01[016789][\s-]?\d{3,4}[\s-]?\d{4}\b/g,
   '[KR phone redacted]', 'KR_phone'],

  // Korean Resident Registration Number: YYMMDD-NNNNNNN (hyphen required)
  [/\b\d{6}-\d{7}\b/g,
   '[KR RRN redacted]', 'KR_RRN'],

  // Credit / debit card: 4 groups of 4 digits separated by spaces or hyphens
  [/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
   '[card redacted]', 'credit_card'],
];

// Trigger phrases that signal a user is about to enter real personal data
const PII_INTENT = /\b(my\s+(email|phone|mobile|address|ssn|tax\s+file|passport|date\s+of\s+birth|dob|tfn)|real\s+(name|email|address|phone|number)|personal\s+(details|information|data)\s+(is|are|:))\b/i;

function redactPii(text, context = 'input') {
  for (const [pattern, placeholder, name] of PII_PATTERNS) {
    const replaced = text.replace(pattern, placeholder);
    if (replaced !== text) {
      logEvent('redacted', name, context);
      text = replaced;
    }
  }
  return text;
}

function checkPiiIntent(text) {
  if (PII_INTENT.test(text)) {
    logEvent('intent_blocked', 'pii_intent_phrase', 'input');
    throw new HttpError(400,
      'Please do not enter real personal information (email addresses, phone numbers, ' +
      'dates of birth, passport or ID numbers, or account numbers) into this tool. ' +
      'Use fictional or anonymised data instead.');
  }
}

// ── 3. Toxicity ────────────────────────────────────────────────────────────────

const TOXIC_HARD = /\b(kill\s+(all|every)\s+\w+|how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|weapon|poison|explosive)|how\s+to\s+(commit|perform)\s+(murder|suicide|self[\s-]harm)|i\s+(want\s+to|will)\s+(kill|murder|harm)\s+(you|everyone|myself))\b/i;

const TOXIC_SOFT_OUTPUT = /\b(step[\s-]by[\s-]step\s+(guide|instructions?)\s+(to|for)\s+(harm|hurt|attack|injure)|detailed\s+instructions?\s+(on\s+)?(how\s+to\s+)?(harm|hurt|attack|injure|kill))\b/i;

function checkInputToxicity(text) {
  if (TOXIC_HARD.test(text)) {
    logEvent('blocked', 'toxic_input', 'input');
    throw new HttpError(400,
      'Your message contains content that violates our usage policy. ' +
      'Please keep requests professional and appropriate.');
  }
}

function checkOutputToxicity(text) {
  if (TOXIC_HARD.test(text) || TOXIC_SOFT_OUTPUT.test(text)) {
    logEvent('blocked', 'toxic_output', 'output');
    throw new ProviderError('Content guard', 502, 'response blocked by content policy');
  }
}

// ── 4. Bias & fairness (output only) ──────────────────────────────────────────

const BIAS_OUTPUT = /\b((all|every|most)\s+(women|men|blacks|whites|asians|muslims|jews|christians|latinos?|hispanics?)\s+(are|can'?t|cannot|don'?t|never|always)|(women|men)\s+(are\s+)?(naturally|inherently|biologically)\s+(worse|better|less|more)\s+(at|suited)|(blacks?|whites?|asians?|latinos?)\s+(are\s+)?(naturally|inherently|biologically)\s+(less|more|worse|better)|(only|prefer)\s+(hire|recruit|select)\s+\w+\s+(because|as\s+they\s+are)|(women|minorities|disabled\s+people)\s+(should\s+not|shouldn'?t|cannot)\s+(lead|manage|hold))\b/i;

function checkOutputBias(text) {
  if (BIAS_OUTPUT.test(text)) {
    logEvent('blocked', 'bias_output', 'output');
    throw new ProviderError('Content guard', 502, 'response blocked due to potential bias');
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Redact PII + check copyright + check toxicity, but skip the intent-phrase block.
// Used by sanitizeFacts where we want silent cleanup of stored text rather than
// rejecting the whole request because the user said "my phone is…"
function redactPiiOnly(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  checkCopyright(text);
  checkInputToxicity(text);
  return redactPii(text, 'input');
}

/**
 * Run all input-side guards. Returns the sanitized (PII-redacted) text.
 * Throws HttpError(400) on policy violation so callers get a clean 400.
 * Call before passing any user-supplied text to the LLM.
 */
export function sanitizeInput(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  checkPiiIntent(text);
  checkCopyright(text);
  checkInputToxicity(text);
  return redactPii(text, 'input');
}

/**
 * Run all output-side guards. Returns the sanitized text.
 * Throws ProviderError(502) if the model generated unsafe content.
 * Call on the raw LLM response before returning it to the client.
 */
export function sanitizeOutput(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  checkOutputToxicity(text);
  checkOutputBias(text);
  return redactPii(text, 'output');
}

/**
 * Recursively walk a JSON object from the LLM and sanitize all string values.
 * Safe to call on any structured AI response.
 */
export function sanitizeOutputObj(obj) {
  if (typeof obj === 'string') return sanitizeOutput(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeOutputObj);
  if (obj !== null && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = sanitizeOutputObj(v);
    return out;
  }
  return obj;
}

/**
 * Sanitize the free-text user-supplied fields inside a facts object.
 * Returns a new facts object with PII redacted and toxic content blocked.
 * Only touches the fields the user types directly; AI-generated structured
 * fields (picks, confidence bands, etc.) are left unchanged.
 */
export function sanitizeFacts(facts) {
  if (!facts || typeof facts !== 'object') return facts;
  const out = { ...facts };
  // Use redactPiiOnly (not sanitizeInput) — stored text may contain phrases like
  // "my phone is…" which are valid free-form notes, not PII-intent signals
  if (typeof out.dump === 'string') out.dump = redactPiiOnly(out.dump);
  if (typeof out.anythingElse === 'string') out.anythingElse = redactPiiOnly(out.anythingElse);
  if (typeof out.customer === 'string') out.customer = redactPiiOnly(out.customer);
  if (typeof out.question === 'string') out.question = redactPiiOnly(out.question);
  if (Array.isArray(out.transcript)) {
    out.transcript = out.transcript.map((m) =>
      m && typeof m.text === 'string' ? { ...m, text: redactPiiOnly(m.text) } : m
    );
  }
  if (Array.isArray(out.findings)) {
    out.findings = out.findings.map((f) => (typeof f === 'string' ? redactPiiOnly(f) : f));
  }
  return out;
}

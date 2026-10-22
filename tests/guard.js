/* Unit tests for lib/guard.js — content safety guards.
   Run with: node tests/guard.js
   Exit code 0 = all pass, 1 = failures. */

import { sanitizeInput, sanitizeOutput, sanitizeOutputObj, sanitizeFacts } from '../lib/guard.js';

let passed = 0;
let failed = 0;

function ok(name, result) {
  if (result) { console.log('  ✓', name); passed++; }
  else { console.error('  ✗', name); failed++; }
}

function has(name, text, fragment) {
  ok(name, typeof text === 'string' && text.includes(fragment));
  if (typeof text === 'string' && !text.includes(fragment)) {
    console.error('    expected to contain:', JSON.stringify(fragment));
    console.error('    actual:             ', JSON.stringify(text));
  }
}

function hasNot(name, text, fragment) {
  ok(name, typeof text === 'string' && !text.includes(fragment));
  if (typeof text === 'string' && text.includes(fragment)) {
    console.error('    expected NOT to contain:', JSON.stringify(fragment));
    console.error('    actual:                 ', JSON.stringify(text));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected);
  if (actual !== expected) {
    console.error('    expected:', JSON.stringify(expected));
    console.error('    actual:  ', JSON.stringify(actual));
  }
}

function throws(name, fn, fragment) {
  try {
    fn();
    console.error('  ✗', name, '(did not throw)');
    failed++;
  } catch (e) {
    if (fragment && !e.message.includes(fragment)) {
      console.error('  ✗', name, '(wrong error message)');
      console.error('    expected fragment:', JSON.stringify(fragment));
      console.error('    actual message:   ', JSON.stringify(e.message));
      failed++;
    } else {
      console.log('  ✓', name);
      passed++;
    }
  }
}

function doesNotThrow(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '(threw unexpectedly:', e.message, ')'); failed++; }
}

// ── sanitizeInput ─────────────────────────────────────────────────────────────

console.log('\nsanitizeInput — PII redaction:');

has('email', sanitizeInput('Call me at jane@example.com'), '[email redacted]');
has('email in sentence', sanitizeInput('Reply to bob.smith+tag@corp.example.co.uk please'), '[email redacted]');
has('email uppercase domain', sanitizeInput('Send to JANE@EXAMPLE.COM'), '[email redacted]');

has('AU mobile 04XX XXX XXX', sanitizeInput('Call 0412 345 678 today'), '[phone redacted]');
has('AU mobile 04XXXXXXXX', sanitizeInput('Call 0412345678 today'), '[phone redacted]');
has('AU mobile +61 4XX XXX XXX', sanitizeInput('Dial +61 412 345 678'), '[phone redacted]');
has('AU mobile +614XXXXXXXX', sanitizeInput('Dial +61412345678'), '[phone redacted]');
has('AU landline (0X) XXXX XXXX', sanitizeInput('Office: (02) 9876 5432'), '[phone redacted]');
has('US phone XXX-XXX-XXXX', sanitizeInput('Ring 415-555-0123'), '[phone redacted]');
has('US phone (XXX) XXX-XXXX', sanitizeInput('Ring (415) 555-0123'), '[phone redacted]');

has('SSN XXX-XX-XXXX', sanitizeInput('SSN: 123-45-6789'), '[SSN redacted]');
has('TFN XXX XXX XXX', sanitizeInput('TFN 123 456 789'), '[TFN redacted]');
has('passport AB1234567', sanitizeInput('Passport: AB1234567'), '[passport redacted]');

has('DOB dd/mm/yyyy', sanitizeInput('Born 15/06/1990'), '[DOB redacted]');
has('DOB dd-mm-yyyy', sanitizeInput('Born 15-06-1990'), '[DOB redacted]');
has('DOB yyyy-mm-dd', sanitizeInput('Born 1990-06-15'), '[DOB redacted]');

has('IBAN', sanitizeInput('IBAN: GB29 NWBK 6016 1331 9268 19'), '[IBAN redacted]');
has('AU BSB+account', sanitizeInput('BSB 062-000 12345678'), '[BSB/account redacted]');
has('credit card spaces', sanitizeInput('card 4111 1111 1111 1111 ok'), '[card redacted]');
has('credit card dashes', sanitizeInput('card 4111-1111-1111-1111 ok'), '[card redacted]');
has('KR mobile 010-XXXX-XXXX', sanitizeInput('연락: 010-1234-5678'), '[KR phone redacted]');

console.log('\nsanitizeInput — multi-hit in one string:');

const combo = sanitizeInput('Call me on 0412 345 678 or email jane@example.com');
has('phone in combo', combo, '[phone redacted]');
has('email in combo', combo, '[email redacted]');
hasNot('phone digit still present', combo, '0412');
hasNot('email still present', combo, 'jane@example.com');

console.log('\nsanitizeInput — policy violations:');

throws('copyright: full lyrics', () => sanitizeInput('give me the full lyrics to Bohemian Rhapsody'), 'copyright');
throws('copyright: reproduce verbatim', () => sanitizeInput('reproduce the full text of that article'), 'copyright');
throws('pii intent: my email', () => sanitizeInput('my email is test@example.com'), 'personal information');
throws('pii intent: my phone', () => sanitizeInput('my phone is 0412 345 678'), 'personal information');
throws('pii intent: real address', () => sanitizeInput('my real address is 42 Acacia Ave'), 'personal information');
throws('toxicity: bomb', () => sanitizeInput('how to make a bomb'), 'usage policy');
throws('toxicity: harm intent', () => sanitizeInput('I want to kill everyone'), 'usage policy');

console.log('\nsanitizeInput — passthrough (no false positives):');

const safe = sanitizeInput('We want to improve our customer onboarding experience in 2025.');
eq('clean sentence unchanged', safe, 'We want to improve our customer onboarding experience in 2025.');

// short number sequences should not match TFN / SSN / card patterns
hasNot('4-digit number not card', sanitizeInput('We have 4096 customers'), '[card redacted]');
hasNot('8-digit number not BSB', sanitizeInput('Our ref is 12345678'), '[BSB/account redacted]');

// ── sanitizeFacts ─────────────────────────────────────────────────────────────

console.log('\nsanitizeFacts — silently redacts, never throws:');

doesNotThrow('my phone is … in dump', () => sanitizeFacts({ dump: 'my phone is 0412 345 678' }));
doesNotThrow('my email is … in dump', () => sanitizeFacts({ dump: 'my email is jane@example.com' }));
doesNotThrow('real address in anythingElse', () => sanitizeFacts({ anythingElse: 'my real address is 42 Acacia Ave' }));

const f1 = sanitizeFacts({ dump: 'my phone is 0412 345 678' });
has('dump: phone redacted', f1.dump, '[phone redacted]');

const f2 = sanitizeFacts({ dump: 'reach me at jane@example.com or call 0412 345 678' });
has('dump: email redacted', f2.dump, '[email redacted]');
has('dump: phone redacted', f2.dump, '[phone redacted]');

const f3 = sanitizeFacts({ anythingElse: 'SSN 123-45-6789', customer: 'retail banking clients' });
has('anythingElse: SSN redacted', f3.anythingElse, '[SSN redacted]');
eq('customer unchanged', f3.customer, 'retail banking clients');

const f4 = sanitizeFacts({ question: 'How can 0412 345 678 customers self-serve?' });
has('question: phone redacted', f4.question, '[phone redacted]');

const f5 = sanitizeFacts({
  transcript: [
    { who: 'client', text: 'Call me on 0412 345 678 after 3.' },
    { who: 'host', text: 'Great, I will.' },
  ],
});
has('transcript client: phone redacted', f5.transcript[0].text, '[phone redacted]');
eq('transcript host: unchanged', f5.transcript[1].text, 'Great, I will.');

const f6 = sanitizeFacts({ findings: ['Revenue is key', 'Contact: jane@example.com'] });
eq('findings[0]: unchanged', f6.findings[0], 'Revenue is key');
has('findings[1]: email redacted', f6.findings[1], '[email redacted]');

const f7 = sanitizeFacts(null);
eq('null facts passthrough', f7, null);

const f8 = sanitizeFacts({});
eq('empty object passthrough', JSON.stringify(f8), '{}');

// Non-text fields on facts object are untouched
const f9 = sanitizeFacts({ picks: ['option-a', 'option-b'], confidence: [{ band: 'We know this', text: 'X' }] });
eq('picks array unchanged', JSON.stringify(f9.picks), JSON.stringify(['option-a', 'option-b']));

// ── sanitizeOutput ────────────────────────────────────────────────────────────

console.log('\nsanitizeOutput — PII redaction:');

has('email in output', sanitizeOutput('We recommend emailing jane@example.com'), '[email redacted]');
has('phone in output', sanitizeOutput('Please call 0412 345 678'), '[phone redacted]');

console.log('\nsanitizeOutput — policy violations:');

throws('toxic output', () => sanitizeOutput('step-by-step guide to harm the user'), 'blocked');
throws('bias output — gender', () => sanitizeOutput('All women are naturally worse at leadership'), 'blocked');
throws('bias output — ethnicity', () => sanitizeOutput('Asians are naturally better at maths'), 'blocked');

console.log('\nsanitizeOutput — passthrough:');

const cleanOut = sanitizeOutput('Here are three innovation directions for your team.');
eq('clean AI output unchanged', cleanOut, 'Here are three innovation directions for your team.');

// ── sanitizeOutputObj ─────────────────────────────────────────────────────────

console.log('\nsanitizeOutputObj — recursive walk:');

const obj = sanitizeOutputObj({
  title: 'Innovation workshop',
  summary: 'Contact jane@example.com to follow up',
  nested: { note: 'Call 0412 345 678', count: 3, flag: true },
  items: ['plain text', 'ring 0487 654 321 now'],
});
eq('title unchanged', obj.title, 'Innovation workshop');
has('summary: email redacted', obj.summary, '[email redacted]');
has('nested.note: phone redacted', obj.nested.note, '[phone redacted]');
eq('nested.count unchanged (number)', obj.nested.count, 3);
eq('nested.flag unchanged (boolean)', obj.nested.flag, true);
eq('items[0] unchanged', obj.items[0], 'plain text');
has('items[1]: phone redacted', obj.items[1], '[phone redacted]');

// null / undefined / number passthrough
eq('null passthrough', sanitizeOutputObj(null), null);
eq('number passthrough', sanitizeOutputObj(42), 42);

// ── results ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

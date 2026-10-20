# Agent Guidelines

Rules for AI agents working on this codebase. Multiple agents may work in parallel —
stay inside your assigned file to avoid conflicts.

## File Ownership

Each agent should own one file per task. Do not edit files outside your area.

| File | Responsible for |
|---|---|
| `lib/prompts.js` | All AI prompt text, voice call script, image style |
| `lib/brief.js` | AI call logic, generation stages, document reading |
| `lib/store.js` | Data persistence only — no business logic |
| `routes/briefs.js` | Client-facing API endpoints (`/api/briefs/*`) |
| `routes/admin.js` | Internal console API endpoints (`/api/console/*`) |
| `public/scripts/brief.js` | Navigation flow, screen rendering, step blocks |
| `public/scripts/brief-controls.js` | Reusable UI controls (editIn, trio, pills, lines, gslider) |
| `public/scripts/brief-client.js` | Server API calls only — `BID` and `api()` |
| `public/styles/brief.css` | All visual styles |
| `public/pack.html` | Team pack deck layout and slide rendering |

## Hard Rules

**1. One file per task.**
If your change requires editing more than two files, stop and flag it. It is likely a
structural change that needs coordination, not a feature addition.

**2. Never change the API shape without flagging.**
`routes/briefs.js` and `routes/admin.js` define the contract between frontend and
backend. Changing a response shape or URL breaks the other side. Always note the
change explicitly and check both sides.

**3. Never add `fetch()` calls outside `brief-client.js`.**
All server communication in the browser goes through `api()` in `brief-client.js`.
If you need a new endpoint, add it there — not inline in a block or control.

**4. Never change the data shape in `lib/store.js` silently.**
`brief.json` on disk is the persistent record. Adding or renaming fields requires a
note about backwards compatibility with existing saved briefs.

**5. Prompts live in `lib/prompts.js` only.**
Do not inline prompt strings in `lib/brief.js` or anywhere else. If a prompt needs
changing, it is always in `lib/prompts.js`.

## Shared Files (touch with care)

These files are imported by many others. Changes here can break everything:

- `lib/config.js` — model names, endpoint config
- `lib/errors.js` — shared HttpError class
- `lib/providers/index.js` — AI provider wiring

If you must change one of these, state what you are changing and why before editing.

## What "Focused" Looks Like

Good: *"Add a regen button to the customer snapshot step"* → edit `public/scripts/brief.js` only.

Bad: *"Improve the customer snapshot"* → ends up touching `prompts.js`, `brief.js`,
`brief-controls.js`, and `store.js` in one pass. Break this into separate tasks.

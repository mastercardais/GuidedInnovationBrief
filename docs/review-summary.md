# Review Summary — Coverage, Accuracy, Simplification

Written for: team reviewing whether the current flow fully answers the standard brief template, whether the AI outputs are trustworthy, and where the UX can shrink.

---

## 1. Coverage of `questions.md`

5 of 11 template questions are fully covered; 4 are partial; 2 are weak.

| Template question | Status | Where it lives |
|---|---|---|
| Why 1 — why run the event | ⚠ Partial | Only in voice/dump context |
| Why 2 — what you observed | ✅ Full | `docs` → `digest.findings` |
| Why 3 — why a problem | ✅ Full | `conf` confidence slider |
| Cust 1 — who is the customer | ✅ Full | `cust` |
| Cust 2 — benefit for customer | ✅ Full | `custout` |
| Cust 3 — customer motivators | ❌ Weak | Voice only, no screen |
| Biz 1 — benefit for business | ✅ Full | `win` |
| Biz 2 — existing service critique | ❌ Weak | Voice only, no screen or pack field |
| Biz 3 — admired solution | ⚠ Partial | Voice + internal pack `inspiration` |
| Challenge — HMW | ✅ Full | `hmw` |
| Success — successful week | ⚠ Partial | `press` + `workshopOutcome` + `concerns`, no metric |

**Biggest gaps:** no dedicated screen for *why the current service fails* or for *quantified success criteria*.

---

## 2. Accuracy of AI outputs

### What protects quality today

| Mechanism | Where |
|---|---|
| Strict `json_schema` on every call | [lib/providers/openai.js:19](lib/providers/openai.js#L19) |
| Server-side `check()` rejects empty fields | [lib/brief.js:48](lib/brief.js#L48) |
| `HOUSE` tone + anti-jargon rules | [lib/prompts.js:4](lib/prompts.js#L4) |
| Docs → Text fallback on 5xx | [lib/brief.js:68](lib/brief.js#L68) |
| Image refusal cache (never re-paint) | [lib/brief.js:179](lib/brief.js#L179) |
| Client edits/regens every slot | every screen |

### What is missing

- **No LLM-output eval suite.** `npm run e2e` tests the flow, not the content quality.
- **Only one factual guard in the whole codebase:** `saidByThem()` in [routes/briefs.js:29](routes/briefs.js#L29) checks the pack `quote` has ≥60% of its words from the client's own words. Nothing else is grounding-checked.
- **No citation verification** for `digest.findings` (prompt asks for "(board paper, p. 6)" but page numbers are never validated).
- **No signal to the user when AI confidence is low** (e.g. when only 1 doc + 10 words of dump have been given, the model still produces 3 confident customer descriptions).

### Risk ranking

| Risk | Why |
|---|---|
| Hallucinated numbers / dates / sources | Prompt warns "never invent"; no automatic check |
| `confidence[0]` picked wrong | Model judgement, no verification before client rates it |
| `businessValue` top 3 drift from client's real priorities | Six options; if none match, client picks the least wrong |
| Transcript cleanup in `pack.quote` | 60% word-overlap threshold may drop paraphrased truth |

---

## 3. Simplification opportunities

Current flow: 18 blocks, ~20 steps. Target: 11–12 steps without losing content.

| Change | Rationale | Steps saved |
|---|---|---|
| Fold 3 intro pages (`confintro` / `pressintro` / `teasersintro`) into inline titles | They carry no input | 3 → 0 |
| Merge `custout` + `conf` into one swipeable card group | Both react to the same `frame` output | 4 → 2 |
| Move `concerns` to appear after `press` on the same screen | Natural flow: see the win, then name blockers | 1 → inline |
| Move `team` invite to the `sent` page footer | Inviting others is a post-submit action | 1 → 0 |
| Make the `docs` findings confirmation a floating confirmation instead of a dedicated screen | Reading happens in the background anyway | 1 → inline |

**Two higher-value UX wins (not step cuts):**

1. **Show the AI's model of the client.** Add an editable "Here's what we think you're saying…" paragraph before `cust`, so the client can correct the AI's mental model before voting on options.
2. **Detect sparse input and ask again.** When the browser's `facts()` is thin (short dump, few findings), route back into `dump` for a short follow-up before `frame` runs. Right now the flow runs end-to-end even on near-empty input, so the LLM fills gaps by inventing.

---

## Bottom line

- **Coverage** — Core questions covered; "existing service" and "customer motivators" are the obvious misses.
- **Accuracy** — Shape is guarded, substance is not. One factual guard (`saidByThem`) across the whole app.
- **Simplification** — Flow can shrink from ~20 to ~12 steps by cutting intro pages and merging reaction screens. The bigger lift is a density check that avoids running the whole flow on empty inputs.

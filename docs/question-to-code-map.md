# Question Template → Code Implementation Map

Written for: engineers who need to see at a glance which template question is covered where, by which prompt, with which AI capability.

---

## Table 1 — Template question → Flow block → Prompt → AI

| # | Template question | Flow block | Prompt (`lib/prompts.js`) | AI capability | Model | Coverage |
|---|---|---|---|---|---|---|
| Why 1 | Why run an innovation event? | `dump` + `docs` | `chat` [L179](lib/prompts.js#L179) / `liveInstructions` [L192](lib/prompts.js#L192) / `digest` [L21](lib/prompts.js#L21) | Text + Voice + Docs | luna / live-1 / terra | ⚠ Partial |
| Why 2 | What have you observed? | `docs` | `digest.findings` [L21](lib/prompts.js#L21) | Docs | `gpt-5.6-terra` | ✅ Full |
| Why 3 | Why is this a problem? | `dump` + `confintro` + `conf` | `frame.confidence` [L38](lib/prompts.js#L38) | Text | `gpt-5.6-luna` | ✅ Full |
| Cust 1 | Who is the customer? | `cust` | `frame.customer` [L38](lib/prompts.js#L38) | Text | `gpt-5.6-luna` | ✅ Full |
| Cust 2 | If solved, why good for customer? | `custout` | `frame.changes` [L38](lib/prompts.js#L38) | Text | `gpt-5.6-luna` | ✅ Full |
| Cust 3 | Customer's fundamental needs? | `dump` (voice only) | `liveInstructions` item 3 [L192](lib/prompts.js#L192) | Voice | `gpt-live-1` | ❌ Weak |
| Biz 1 | If solved, why good for business? | `win` | `question.businessValue` [L69](lib/prompts.js#L69) | Text | `gpt-5.6-luna` | ✅ Full |
| Biz 2 | Existing service tackling the problem? | `dump` (voice only) | `liveInstructions` item 4 [L192](lib/prompts.js#L192) | Voice | `gpt-live-1` | ❌ Weak |
| Biz 3 | An admired solution? | `dump` tail + pack | `liveInstructions` item 8 [L192](lib/prompts.js#L192) + `pack.inspiration` [L243](lib/prompts.js#L243) | Voice + Docs | live-1 / terra | ⚠ Partial |
| Chlg 1 | How Might We statement | `hmw` | `question.hmw` [L60](lib/prompts.js#L60) | Text | `gpt-5.6-luna` | ✅ Full |
| Succ 1 | Successful result at week end? | `press` + `concerns` + `pack` | `story` [L88](lib/prompts.js#L88) + `question.concerns` [L77](lib/prompts.js#L77) + `pack.workshopOutcome` [L242](lib/prompts.js#L242) | Text + Image + Voice | luna / flare / live-1 | ⚠ Partial |

---

## Table 2 — Extra flow blocks (not in the template)

| Flow block | Prompt | AI capability | Produces |
|---|---|---|---|
| `teasersintro` + `teasers` × 4 | `directions` [L111](lib/prompts.js#L111) + `boardPrompt` [L130](lib/prompts.js#L130) | Text + Image | 4 concept directions, each a 3-panel Copic storyboard |
| `anything` | — | — | Free-text catch-all |
| `team` | — | — | Invite collaborators (email only) |
| `end` / `sent` | `pack` [L220](lib/prompts.js#L220) | Docs (→ Text fallback) | Internal pack: runner, quote, cans, runsheet, cut, gaps, workshopOutcome, inspiration |
| background `earlyPhoto` | `earlyPhoto` [L137](lib/prompts.js#L137) + `photoPrompt` [L133](lib/prompts.js#L133) | Text + Image | Press-release editorial photo, started while client answers |

---

## Table 3 — Four AI stages (orchestrated client-side)

Source: [public/scripts/brief.js:159](public/scripts/brief.js#L159) + [lib/brief.js:100](lib/brief.js#L100)

| Stage | Fires after | Prompts (parallel?) | Outputs | Screens that need it |
|---|---|---|---|---|
| `frame` | `dump` / `custout` leave | `frame` (1 call) | customer × 3, changes × 3, confidence × 3 | `cust`, `custout`, `conf` |
| `question` | `conf` / `hmw` leave | `question.hmw`, `question.businessValue`, `question.concerns` **in parallel** | hmw × 3, businessValue × 6, concerns × 4 | `hmw`, `win`, `concerns` |
| `story` | `win` leave | `story` (reuses earlyPhoto image) | dateline, headline, body, quote, photo | `press` |
| `directions` | `win` leave (parallel w/ `story`) | `directions` + 4× `boardPrompt` images | 4 concepts with storyboards | `teasers` |

---

## Table 4 — AI slots, models, providers

Source: [lib/config.js](lib/config.js) + [lib/providers/index.js](lib/providers/index.js)

| Slot | Default model | Provider options | API used | Fallback |
|---|---|---|---|---|
| text | `gpt-5.6-luna` | `openai` \| `chat` \| `none` | Responses API, strict `json_schema` | — |
| docs | `gpt-5.6-terra` | `openai` \| `chat` \| `none` | Responses API w/ `input_file` | → text slot on 5xx (`careful()` [L68](lib/brief.js#L68)) |
| image | `gpt-image-2.5-flare` | `openai` \| `none` | `/images/generations`, base64 | refusals cached, never re-painted |
| voice | `gpt-live-1` | `openai-live` \| `none` (→ typed chat) | GPT-Live over WebRTC | typed `chat` prompt if off |
| transcribe | `gpt-transcribe` | `openai` \| `none` | `/audio/transcriptions` multipart | mic hidden if off |

---

## Table 5 — Prompt-engineering patterns

| Pattern | Where | Why |
|---|---|---|
| Shared `HOUSE` prefix | [prompts.js:4](lib/prompts.js#L4) | One source for tone rules (plain English, AU spelling, no jargon, no invented facts, no Mastercard product names) |
| Strict JSON Schema | every prompt via `obj()` / `arr()` helpers | Server rejects malformed replies via `check()` [brief.js:48](lib/brief.js#L48) — no screens with holes |
| 3 parallel sub-prompts for `question` | [prompts.js:57](lib/prompts.js#L57) comment | One 13-field prompt took ~20s; three short ones feel instant |
| `regen` dedup | [prompts.js:155](lib/prompts.js#L155) | Passes `current` + `others` so model must produce something different |
| Shared `context()` | [brief.js:22](lib/brief.js#L22) | Browser sends `facts()` with every call; server rebuilds the same picture for every prompt |
| Docs → Text fallback | [brief.js:68 `careful`](lib/brief.js#L68) | Protects against one vendor's bad afternoon |
| Image dedup by hash | [brief.js:167 `startImage`](lib/brief.js#L167) | SHA-1(`size\|prompt`) → never paint the same image twice |
| Early photo | [brief.js:110](lib/brief.js#L110) | Starts after voice call ends, so it's ready by `press` screen |

---

## Table 6 — Coverage verdict

| Template section | Coverage | Why | What's missing |
|---|---|---|---|
| Why 1 | ⚠ Partial | Lives in voice/dump context only; no screen | Dedicated "problem statement" screen |
| Why 2 | ✅ Full | `digest.findings` confirmed on screen | — |
| Why 3 | ✅ Full | 3 confidence claims rated on slider | — |
| Customer 1–2 | ✅ Full | `cust` + `custout` map 1:1 | — |
| Customer 3 | ❌ Weak | Voice only | Screen for functional/emotional/social motivators |
| Business 1 | ✅ Full | `win` (6 options, pick 3, flag priority) | — |
| Business 2 | ❌ Weak | Voice step 4 only | Screen or pack field for existing-service critique |
| Business 3 | ⚠ Partial | Voice step 8 + internal pack `inspiration` | No client-facing screen |
| HMW | ✅ Full | `hmw` 3 options + edit + write-own | — |
| Define Success | ⚠ Partial | `press` + `workshopOutcome` + `concerns` | No success-metric slider |

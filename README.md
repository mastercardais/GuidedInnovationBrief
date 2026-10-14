# Innovation Brief: the real build

The post-SOW innovation brief, working for real. A client opens a link, uploads their documents, talks or
types about what's going on, and reacts to options an AI writes from what they've said. Digital Labs gets
back a brief, a team pack and an internal session brief.

## Run it

Needs Node 22 or later. No npm install needed.

```
cp .env.example .env      # then fill in AI_BASE_URL and AI_API_KEY
node server.js
```

Open **http://127.0.0.1:3000**. That's the Digital Labs console. Create a brief (client, who fills it in,
their role) and the client's link is copied for you. Open it to play the client.

## Configuration

Everything is in `.env` (see `.env.example`). The two required lines:

```
AI_BASE_URL=https://digitallabs-wireframe-b-resource.openai.azure.com/openai/v1
AI_API_KEY=<your key>
```

The server prints where each capability sends its data on startup. Every AI call goes through `AI_BASE_URL`
unless a slot names its own `AI_<SLOT>_BASE_URL`.

## Models

| Capability | Model | What it does |
|---|---|---|
| **Text** | `gpt-5.6-luna` | Every option and question the client sees |
| **Docs** | `gpt-5.6-terra` | Reading uploaded documents, writing the pack |
| **Images** | `gpt-image-2.5-flare` | Concept storyboards and the story photo |
| **Voice** | `gpt-live-1` | "Talk it through" — the live voice call |
| **Dictation** | `gpt-transcribe` | Mic in "Write it down" (not yet deployed — set `AI_TRANSCRIBE_PROVIDER=none`) |

Each capability can be switched to `none` independently.

## What's real

| Screen | What happens |
|---|---|
| Bring your docs | Files (PDF, Word, PowerPoint, Excel) are uploaded and read. Findings come from the documents. |
| In your own words | **Write it down** types or dictates. **Talk it through** is a live voice call via WebRTC, ending with what they hope to leave the workshop with and, if time, a business they admire. |
| Who / what changes / how sure | Written from their documents and their own words. |
| The question, business value, worries | Written from everything so far, including confidence levels. Business value is picked top three and flagged by priority. |
| The story | A press article set two years out, plus an editorial photo. Photo generation starts when the client ends the call and runs in the background through the rest of the brief. |
| Early directions | Four concepts, each with a Copic marker storyboard (three panels). |
| Every option | Regenerate asks the model for a genuinely new one. Edit and write-your-own work as before. |
| Sent | Answers lock. The client and internal PDFs both show the hoped-for workshop outcome; the internal version adds any client-named inspiration, the runsheet and gaps. |

## Where to change things

| To change | Edit |
|---|---|
| AI wording and rules | `lib/prompts.js` (`HOUSE` applies to all) |
| Voice call interviewer | `liveInstructions()` in `lib/prompts.js` |
| Concept art style | `boardPrompt()` in `lib/prompts.js` |
| Screen copy, order, intros | `public/assets/brief.js` (`FLOW`, `block({...})`, `intro(...)`) |
| Models, endpoints, keys | `.env` (see `.env.example`) |
| The team pack | `pack` in `lib/prompts.js` and `public/pack.html` |

**Restart the server after editing `lib/`.** `public/` changes only need a browser refresh.

The press-release photo is generated as a square image and displayed in a 16:9 landscape frame.
The crop is top-weighted (`background-position: center 20%`) so most of the removed area comes from
the bottom. The same generated image appears in the team pack.

## Providers

- **Text**: `openai` (Responses API) or `chat` (any OpenAI-compatible `/chat/completions` endpoint)
- **Images**: `openai` or `none` (cards show words on colour, no art)
- **Voice**: `openai-live` or `none` (becomes a typed chat with the text model)
- **Dictation**: `openai` (any `/audio/transcriptions` endpoint) or `none` (mic button hidden)

Adding a vendor: one file in `lib/providers/` with the same shape, registered in `lib/providers/index.js`.

## Test it

```
npm run e2e          # the typed path, every screen
npm run e2e:voice    # the voice call, with a synthetic client
npm run e2e:phone    # 390 × 844
```

## Known issues
- **No accounts.** The brief link is the key (96 random bits). The console is open unless `CONSOLE_TOKEN` is set.
- **Local files, one machine.** Briefs live in `data/briefs/<id>/`. `lib/store.js` is the only file that
  would change for a database.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const KEY = readFileSync(homedir()+'/.claude/.env','utf8').match(/^OPENAI_API_KEY=["']?(.+?)["']?$/m)[1];
const idea = `The idea: members vote on how their account protects their pay. Screen content, with the exact text: a headline card "You decide what protects your pay", a status chip "Vote open", two choice chips "Block unknown payees" and "Show every fee clearly", a progress bar "Votes counted openly", a notification "Here is what changed".`;
const common = `No logos, no brand names, no real people's faces, no watermark. Keep everything important in the upper two thirds of the frame; the bottom third is quiet paper.`;
const S = {
  A: `A quick concept sketch drawn with Copic markers and a black fineliner on white marker paper. ${idea}
Draw one phone-screen outline, loose and hand-drawn, with the headline card and chips sketched inside it; the other pieces float beside it as small sketched callouts joined by hand-drawn arrows. Cool grey marker shading (N1 to N4), one warm accent in orange marker used on the key button and chip. Hand-lettered labels in neat designer block capitals. Visible marker streaks and slight overlap past the lines, like a thumbnail sketch from a design sprint. ${common}`,
  B: `A design-sprint storyboard drawn in Copic markers and black fineliner on white marker paper: three panels in a row, then short hand-lettered captions. ${idea}
Panel 1: a simple sketched figure (no face detail) gets the "Vote open" notification on a phone. Panel 2: a close-up of the phone screen with the headline card and the two choice chips, one ticked. Panel 3: the "Here is what changed" notification with a small smile icon. Grey marker tones with an orange accent, loose confident linework, hand-lettered captions in block capitals under each panel. Feels like a real concept storyboard stuck on a workshop wall. ${common}`,
  C: `A polished industrial-design style marker rendering of an app concept, Copic markers with white gel pen highlights on marker paper. ${idea}
A single phone, drawn at a slight three-quarter angle, rendered with confident grey marker gradients and a soft drop shadow; its screen shows the headline card, the two choice chips and the progress bar clearly, with legible hand-lettered text. Two or three annotation callouts with thin leader lines point to the key features in neat block capitals. One warm orange accent. Crisp, presentation-quality concept sketch, like a designer's hero rendering. ${common}`,
};
await Promise.all(Object.entries(S).map(async ([k, prompt]) => {
  const t = Date.now();
  const r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2.5-flare', prompt, size: '1024x1280', quality: 'low', output_format: 'jpeg', n: 1 }) });
  const j = await r.json(); if (!j.data) return console.log(k, JSON.stringify(j).slice(0, 300));
  writeFileSync(new URL(`./${k}.jpg`, import.meta.url), Buffer.from(j.data[0].b64_json, 'base64')); console.log(k, ((Date.now()-t)/1000).toFixed(0)+'s');
}));

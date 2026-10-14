/* OpenAI: Responses for text, Images for the concept art, Live for the call, and audio
   transcriptions for dictation. Each factory takes its own slice of config, so the same code serves
   any endpoint that speaks the same API (Azure OpenAI, a proxy, a gateway). */
import { call, bearer, ProviderError } from './http.js';

/* ---------- text: Responses API with strict JSON output ---------- */
export function openaiText(c) {
  return {
    name: `openai:${c.model}`,
    async json({ system, user, files = [], schema, name = 'result', maxTokens = 16000 }) {
      const content = [
        ...files.map((f) => ({ type: 'input_file', filename: f.name, file_data: `data:${f.mime};base64,${f.base64}` })),
        { type: 'input_text', text: user },
      ];
      const body = {
        model: c.model,
        instructions: system,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name, strict: true, schema } },
        max_output_tokens: maxTokens, // reasoning tokens count against this, so it's generous; only what's used is billed
        store: false,
      };
      if (c.reasoning && c.reasoning !== 'none') body.reasoning = { effort: c.reasoning };
      const res = await call('Text generation', `${c.baseURL}/responses`, {
        method: 'POST', headers: { ...bearer(c.apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, { timeout: files.length ? 180_000 : 90_000 });
      const data = await res.json();
      const text = (data.output || []).filter((o) => o.type === 'message')
        .flatMap((o) => o.content || []).filter((p) => p.type === 'output_text').map((p) => p.text).join('');
      const refusal = (data.output || []).flatMap((o) => o.content || []).find((p) => p.type === 'refusal');
      if (refusal) throw new ProviderError('Text generation', 422, 'the model declined');
      if (data.status === 'incomplete') throw new ProviderError('Text generation', 502, `incomplete: ${data.incomplete_details?.reason}`);
      try { return JSON.parse(text); } catch { throw new ProviderError('Text generation', 502, 'reply was not valid JSON'); }
    },
  };
}

/* ---------- images ---------- */
export function openaiImage(c) {
  return {
    name: `openai:${c.model}`,
    async generate({ prompt, size = '1024x1280' }) {
      const res = await call('Image generation', `${c.baseURL}/images/generations`, {
        method: 'POST', headers: { ...bearer(c.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.model, prompt, size, quality: c.quality, output_format: 'jpeg', output_compression: 82, n: 1 }),
      }, { timeout: 180_000 });
      const data = await res.json();
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError('Image generation', 502, 'no image returned');
      return { bytes: Buffer.from(b64, 'base64'), mime: 'image/jpeg' };
    },
  };
}

/* ---------- voice: GPT-Live over WebRTC ----------
   The browser makes the SDP offer; we post it with the session config and hand back the answer.
   The key and the instructions never leave the server. */
export function openaiLive(c) {
  return {
    name: `openai:${c.model}`,
    async createSession({ instructions, sdp, input = [] }) {
      const session = {
        model: c.model,
        instructions,
        audio: { output: { voice: c.voice } },
        // Client delegation, and the prompt tells it not to delegate: the call is an interview, and
        // anything it could look up is already in its instructions.
        delegation: { type: 'client' },
      };
      if (input.length) session.input = input;
      const res = await call('Voice session', `${c.baseURL}/live/sessions`, {
        method: 'POST', headers: { ...bearer(c.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, transport: { type: 'webrtc', sdp } }),
      }, { timeout: 30_000, retries: 0 });
      const data = await res.json();
      if (!data.transport?.sdp) throw new ProviderError('Voice session', 502, 'no SDP answer');
      return { id: data.session?.id, sdp: data.transport.sdp, iceServers: data.transport.ice_servers ?? null };
    },
  };
}

/* ---------- dictation ---------- */
export function openaiTranscribe(c) {
  return {
    name: `openai:${c.model}`,
    async transcribe({ bytes, mime, filename = 'speech.webm', prompt }) {
      const form = new FormData();
      form.append('model', c.model);
      form.append('file', new Blob([bytes], { type: mime }), filename);
      if (prompt) form.append('prompt', prompt);
      const res = await call('Transcription', `${c.baseURL}/audio/transcriptions`, {
        method: 'POST', headers: bearer(c.apiKey), body: form,
      }, { timeout: 120_000 });
      const data = await res.json();
      return (data.text || '').trim();
    },
  };
}

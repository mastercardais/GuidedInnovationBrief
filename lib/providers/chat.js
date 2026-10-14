/* Any OpenAI-compatible /chat/completions endpoint: Gemini's compatibility layer, OpenRouter, Groq,
   Together, a local model behind LM Studio or Ollama, Azure. This is the escape hatch for swapping the
   text model to another vendor without touching the rest of the app.

   Documents: plain-text files go in as text. Binary documents (PDF, DOCX, PPTX) go in as OpenAI-style
   `file` parts; vendors that reject those (Gemini's compatibility layer does) get a second try with each
   document as a data-URL `image_url`, which is how Gemini takes PDFs. Office files may still be refused
   by some vendors, in which case the client sees "couldn't read those" and can skip. */
import { call, bearer, ProviderError } from './http.js';

const TEXTY = /^(text\/|application\/(json|xml|csv))/;

export function chatText(c) {
  return {
    name: `chat:${c.model}`,
    async json(args) {
      try { return await this.once(args, 'file'); }
      catch (e) {
        if (!args.files?.length || e.status !== 400 || !/content part|file/i.test(e.message)) throw e;
        return this.once(args, 'image_url');
      }
    },
    async once({ system, user, files = [], schema, name = 'result' }, style) {
      const parts = [];
      for (const f of files) {
        const url = `data:${f.mime};base64,${f.base64}`;
        if (TEXTY.test(f.mime)) parts.push({ type: 'text', text: `--- ${f.name} ---\n${Buffer.from(f.base64, 'base64').toString('utf8').slice(0, 200_000)}` });
        else if (style === 'file') parts.push({ type: 'file', file: { filename: f.name, file_data: url } });
        else parts.push({ type: 'text', text: `--- ${f.name} ---` }, { type: 'image_url', image_url: { url } });
      }
      parts.push({ type: 'text', text: user });
      const body = {
        model: c.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: parts }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        // No token cap: vendors disagree on its name (max_tokens vs max_completion_tokens) and a wrong one is a 400.
      };
      const res = await call('Text generation', `${c.baseURL}/chat/completions`, {
        method: 'POST', headers: { ...bearer(c.apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, { timeout: files.length ? 180_000 : 90_000 });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      // Some vendors wrap JSON in a code fence even in JSON mode.
      const clean = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      try { return JSON.parse(clean); } catch { throw new ProviderError('Text generation', 502, 'reply was not valid JSON'); }
    },
  };
}

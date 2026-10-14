/* Picks an adapter per capability from config. To add a vendor, write a factory with the same shape
   (text.json, image.generate, voice.createSession, transcribe.transcribe) and register it here. */
import { config } from '../config.js';
import { openaiText, openaiImage, openaiLive, openaiTranscribe } from './openai.js';
import { chatText } from './chat.js';
import { ProviderError } from './http.js';

const off = (what) => new Proxy({}, { get: (_, k) => k === 'name' ? 'none' : () => { throw new ProviderError(what, 503, 'switched off in config'); } });

const TEXT = { openai: openaiText, chat: chatText };
const IMAGE = { openai: openaiImage };
const VOICE = { 'openai-live': openaiLive };
const TRANSCRIBE = { openai: openaiTranscribe };

function pick(table, c, what) {
  if (c.provider === 'none') return off(what);
  const f = table[c.provider];
  if (!f) throw new Error(`Unknown ${what} provider "${c.provider}". Options: ${Object.keys(table).join(', ')}, none`);
  if (!c.apiKey) return off(what);
  return f(c);
}

export const ai = {
  text: pick(TEXT, config.text, 'Text generation'),
  docs: pick(TEXT, config.docs, 'Reading documents'),
  image: pick(IMAGE, config.image, 'Image generation'),
  voice: pick(VOICE, config.voice, 'Voice session'),
  transcribe: pick(TRANSCRIBE, config.transcribe, 'Transcription'),
};
export { ProviderError };

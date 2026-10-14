/* A tiny Chrome DevTools Protocol driver for end-to-end checks, with no dependencies.
   Launches its own Chrome (temp profile, optional fake microphone from a WAV file), so it never
   touches anyone's real browser. Used by scripts/e2e.js. */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1440, height = 900, micWav = null, headless = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'ib-e2e-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=${width},${height}`, '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (headless) args.push('--headless=new');
  const proc = spawn(CHROME, [...args, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(200);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0; const waiters = new Map(); const logs = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && waiters.has(m.id)) { const w = waiters.get(m.id); waiters.delete(m.id); m.error ? w.j(new Error(m.error.message)) : w.r(m.result); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  };
  const send = (method, params = {}) => new Promise((r, j) => { const id = ++n; waiters.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Browser.grantPermissions', { permissions: ['audioCapture'] }).catch(() => {});
  /* A synthetic microphone. Chrome's --use-file-for-fake-audio-capture delivers silence on current
     builds, so instead getUserMedia is replaced, before any page script runs, with a stream that plays
     the WAV (after a pause, then silence), through the same WebRTC path the real mic takes. */
  if (micWav) {
    const b64 = readFileSync(micWav).toString('base64');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const b64 = ${JSON.stringify(b64)};
      navigator.mediaDevices.getUserMedia = async () => {
        const ac = new AudioContext(); await ac.resume();
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const buf = await ac.decodeAudioData(bytes.buffer);
        const dest = ac.createMediaStreamDestination();
        // A real mic always carries room noise; a source-less stream sends no frames, and GPT-Live's clock
        // only runs on incoming audio. So keep an inaudible tone underneath.
        const hum = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0.0005; hum.connect(g).connect(dest); hum.start();
        // Silent until the test calls window.__micGo(), the way a person waits for the greeting to finish.
        window.__micGo = () => { const src = ac.createBufferSource(); src.buffer = buf; src.connect(dest); src.start(); window.__micDone = new Promise((r) => src.onended = r); };
        return dest.stream;
      };
    })();` });
  }

  const page = {
    logs,
    async goto(url) { await send('Page.navigate', { url }); await sleep(900); },
    async eval(fn, ...args) {
      const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async until(fn, { timeout = 60000, every = 300, label = 'condition' } = {}, ...args) {
      const t = Date.now();
      while (Date.now() - t < timeout) { try { const v = await page.eval(fn, ...args); if (v) return v; } catch {} await sleep(every); }
      throw new Error(`Timed out waiting for ${label}`);
    },
    async shot(path) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(r.data, 'base64')); return path; },
    async size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); },
    async setFiles(selector, files) {
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      await send('DOM.setFileInputFiles', { nodeId, files });
    },
    send,
    async close() { try { ws.close(); } catch {} proc.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); },
  };
  return page;
}

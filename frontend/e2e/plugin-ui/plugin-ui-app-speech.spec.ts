import { expect, test, type Page } from '@playwright/test';

// The "speech" device: the sandboxed screen has no microphone and its CSP blocks media, so the SCHOOL page
// listens (speech recognition), reads text aloud and plays audio for it. The screen receives the recognised
// text and "done" only. A screen whose page did not declare the device gets status 403.
const pluginId = 'wattanam.demo';
const version = '1.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const html = '<!doctype html><html><body><h1>Speak</h1><button id="listen">Listen</button><button id="speak">Speak</button><button id="play">Play</button><button id="bad">Bad audio</button><ul id="out"></ul><script src="app.js"></script></body></html>';
const app = `
const out = (key, value) => { let li = document.getElementById(key); if (!li) { li = document.createElement('li'); li.id = key; document.getElementById('out').appendChild(li); } li.textContent = key + '=' + value; };
const post = (message) => parent.postMessage(Object.assign({ protocol: 'wattanam.plugin-ui/1' }, message), '*');
window.addEventListener('message', (event) => {
  if (event.source !== parent || !event.data || event.data.protocol !== 'wattanam.plugin-ui/1') return;
  const data = event.data;
  if (data.type === 'init') { out('devices', (data.devices || []).join('+') || 'none'); post({ type: 'speech-status', id: 'st' }); }
  if (data.type === 'response') out(data.id, data.status + ':' + JSON.stringify(data.body));
});
document.getElementById('listen').addEventListener('click', () => post({ type: 'speech-listen', id: 'heard', lang: 'en-US', seconds: 10 }));
document.getElementById('speak').addEventListener('click', () => post({ type: 'speech-speak', id: 'spoken', text: 'I like green apples', lang: 'en-GB', rate: 0.8 }));
document.getElementById('play').addEventListener('click', () => post({ type: 'speech-play', id: 'played', audio: '${WAV}' }));
document.getElementById('bad').addEventListener('click', () => post({ type: 'speech-play', id: 'bad', audio: 'data:text/html;base64,PHNjcmlwdD4=' }));
// the screen has no microphone of its own
navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia({ audio: true }).then(() => out('own-mic', 'allowed'), () => out('own-mic', 'blocked')) : out('own-mic', 'blocked');
post({ type: 'ready' });
`;

function pagesWith(devices?: string[]) {
  return [{
    pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', id: 'speak', title: 'Speak', routePath: 'speak',
    permission: 'wattanam.demo.view', parameters: [], dataSources: [],
    components: [{ id: 'speak-app', type: 'app', title: 'Speak', options: { entry: 'ui/index.html', minHeight: 300, ...(devices ? { devices } : {}) } }],
  }];
}

async function host(page: Page, devices?: string[]) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/plugin-ui/${pluginId}/${version}/ui/index.html`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: html });
    if (pathname === `/api/plugin-ui/${pluginId}/${version}/ui/app.js`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': CSP, 'cross-origin-resource-policy': 'cross-origin' }, body: app });
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages: pagesWith(devices) } });
    return route.fulfill({ status: 200, json: [] });
  });
  // the school page's speech engines (headless Chromium has none): recognition hears "Hello there" after a moment
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const log: unknown[] = []; (window as any).__speech = log;
    class FakeRecognition {
      lang = ''; interimResults = false; maxAlternatives = 1; continuous = false;
      onresult: any = null; onerror: any = null; onend: any = null;
      start() {
        log.push({ listen: this.lang });
        setTimeout(() => { const partial: any = [{ transcript: 'Hello' }]; partial.isFinal = false; this.onresult?.({ resultIndex: 0, results: [partial] }); }, 300);
        setTimeout(() => { const result: any = [{ transcript: 'Hello there' }, { transcript: 'hello their' }]; result.isFinal = true; this.onresult?.({ resultIndex: 0, results: [result] }); this.onend?.(); }, 1200);
      }
      stop() {} abort() {}
    }
    (window as any).SpeechRecognition = FakeRecognition; (window as any).webkitSpeechRecognition = FakeRecognition;
    Object.defineProperty(window, 'speechSynthesis', { value: { speak(u: any) { log.push({ speak: u.text, lang: u.lang }); setTimeout(() => u.onend?.({}), 50); }, cancel() {} } });
    (window as any).Audio = function (src: string) { const player: any = { src, pause() {}, play() { log.push({ play: src.slice(0, 15) }); setTimeout(() => player.onended?.(), 50); return Promise.resolve(); } }; return player; };
  });
}

test('a screen that declared speech gets the recognised text and spoken or played audio, never the microphone', async ({ page }) => {
  await host(page, ['speech']);
  await page.goto(`/plugins/${pluginId}/speak`);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#devices')).toHaveText('devices=speech', { timeout: 30_000 });
  await expect(frame.locator('#st')).toHaveText('st=200:{"listen":true,"speak":true,"play":true}');
  await expect(frame.locator('#own-mic')).toHaveText('own-mic=blocked');

  await frame.locator('#listen').click();
  // the school page shows that it is listening (and what it hears so far), with its own Stop button
  await expect(page.locator('[data-plugin-speech]')).toContainText('Listening… Hello');
  await expect(frame.locator('#heard')).toHaveText('heard=200:{"transcript":"Hello there","alternatives":["Hello there","hello their"]}');
  await expect(page.locator('[data-plugin-speech]')).toHaveCount(0);

  await frame.locator('#speak').click();
  await expect(frame.locator('#spoken')).toHaveText('spoken=200:{"spoken":true}');
  await frame.locator('#play').click();
  await expect(frame.locator('#played')).toHaveText('played=200:{"played":true}');
  await frame.locator('#bad').click();
  await page.waitForTimeout(500);
  await expect(frame.locator('#bad')).toHaveText('Bad audio'); // no answer: anything but audio data is ignored
  await expect(frame.locator('li#bad')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__speech)).toEqual([{ listen: 'en-US' }, { speak: 'I like green apples', lang: 'en-GB' }, { play: 'data:audio/wav;' }]);
});

test('a screen that did not declare speech is refused', async ({ page }) => {
  await host(page);
  await page.goto(`/plugins/${pluginId}/speak`);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#st')).toHaveText('st=403:{"message":"This screen has not declared the speech device."}', { timeout: 30_000 });
  await frame.locator('#listen').click();
  await expect(frame.locator('#heard')).toHaveText('heard=403:{"message":"This screen has not declared the speech device."}');
  expect(await page.evaluate(() => (window as any).__speech)).toEqual([]);
});

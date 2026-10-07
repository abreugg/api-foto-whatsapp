import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

/** Execute the real dashboard script; only DOM and network boundaries are mocked. */
async function dashboard({ connectedAtStatus }) {
  const elements = new Map(),
    calls = [];
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        open: false,
        classList: { toggle() {} },
        addEventListener() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
        replaceChildren() {},
      });
    return elements.get(id);
  };
  const context = createContext({
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({}),
    },
    fetch: async (url) => {
      calls.push(url);
      const route = url.slice('/api/admin/'.length);
      let payload = {};
      if (route === 'me') payload = { csrf: 'test' };
      else if (route === 'keys' || route === 'domains' || route === 'connections') payload = [];
      else if (route.startsWith('stats'))
        payload = { totalRequests: 0, cacheHits: 0, errors: 0, savedPhotos: 0, validCache: 0 };
      else if (route.startsWith('history')) payload = { items: [], total: 0 };
      else if (route.endsWith('/status'))
        payload = { Connected: true, LoggedIn: connectedAtStatus };
      else if (route.endsWith('/qr')) payload = { Connected: true, LoggedIn: true, QRCode: '' };
      return { ok: true, status: 200, json: async () => payload };
    },
    URLSearchParams,
    Intl,
    Date,
    console,
    setTimeout: (fn) => ({ fn }),
    clearTimeout() {},
  });
  runInContext(await readFile(new URL('../public/admin/app.js', import.meta.url), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  await runInContext("openQR('session')", context);
  return { elements, calls, context };
}

test('QR modal closes after connected status and does not request another QR', async () => {
  const { elements, calls, context } = await dashboard({ connectedAtStatus: true });
  assert.equal(elements.get('qr-dialog').open, false);
  assert.match(elements.get('toast').textContent, /WhatsApp conectado/);
  assert.ok(!calls.some((url) => url.endsWith('/qr')));
  assert.equal(runInContext('qrTimer', context), undefined);
});

test('QR modal also closes if the QR endpoint detects pairing completion during the race', async () => {
  const { elements, calls, context } = await dashboard({ connectedAtStatus: false });
  assert.equal(elements.get('qr-dialog').open, false);
  assert.equal(calls.filter((url) => url.endsWith('/qr')).length, 1);
  assert.equal(runInContext('qrTimer', context), undefined);
});

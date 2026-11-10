// Regression tests for the GA4 privacy fix: /report, /report/:id, and /app
// must never load or initialize GA4 (they carry a report access token /
// Stripe checkout session id in the URL, which GA's automatic page_view
// would otherwise send to Google). Public marketing pages must keep
// tracking, and the checkout_click event must stay free of PII.
//
// Requires a Chrome/Chromium binary. Set CHROME_PATH to override the
// default lookup (the system Google Chrome on macOS).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const PORT = process.env.TEST_PORT || 3147;
const BASE = `http://localhost:${PORT}`;
const GA_HOST_PATTERN = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/;

const DEFAULT_CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const p of DEFAULT_CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `No Chrome/Chromium binary found (checked: ${DEFAULT_CHROME_PATHS.join(', ')}). ` +
    `Set CHROME_PATH to a valid executable to run this suite.`
  );
}

let serverProc;
let browser;

before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('server did not start in time:\n' + out));
    }, 10000);
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes('is ready')) {
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}):\n${out}`));
    };
    const cleanup = () => {
      serverProc.stdout.off('data', onData);
      serverProc.stderr.off('data', onData);
      serverProc.off('exit', onExit);
    };
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);
    serverProc.once('exit', onExit);
  });

  browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (serverProc) serverProc.kill();
});

async function loadAndInspect(urlPath) {
  const page = await browser.newPage();
  const requestUrls = [];
  page.on('request', (req) => requestUrls.push(req.url()));
  await page.goto(BASE + urlPath, { waitUntil: 'domcontentloaded', timeout: 15000 });
  // Give any early-fired script-injected requests a moment to show up.
  await new Promise((r) => setTimeout(r, 500));
  const gtagType = await page.evaluate(() => typeof window.gtag);
  const dataLayerLen = await page.evaluate(() => (window.dataLayer || []).length);
  await page.close();
  return { requestUrls, gtagType, dataLayerLen };
}

const SENSITIVE_ROUTES = [
  ['/app', 'no query'],
  ['/app?session_id=cs_test_FAKESESSION_abc123', 'Stripe session_id'],
  ['/report', 'no id'],
  ['/report/rep_FAKEREPORT_xyz789', 'report access token'],
];

for (const [route, label] of SENSITIVE_ROUTES) {
  test(`GA does not load or initialize on ${route} (${label})`, async () => {
    const { requestUrls, gtagType, dataLayerLen } = await loadAndInspect(route);
    const gaRequests = requestUrls.filter((u) => GA_HOST_PATTERN.test(u));
    assert.deepEqual(gaRequests, [], `expected no GA requests on ${route}, got: ${gaRequests.join(', ')}`);
    assert.equal(gtagType, 'undefined', `expected window.gtag to be undefined on ${route}`);
    assert.equal(dataLayerLen, 0, `expected no dataLayer entries on ${route}`);
  });
}

test('Stripe session_id never appears in any outgoing request on /app', async () => {
  const token = 'cs_test_FAKESESSION_abc123';
  const { requestUrls } = await loadAndInspect(`/app?session_id=${token}`);
  // The page's own /verify-session call legitimately carries it (first-party,
  // same-origin) — only flag it leaking to a third-party host.
  const thirdPartyLeak = requestUrls.filter((u) => u.includes(token) && !u.startsWith(BASE));
  assert.deepEqual(thirdPartyLeak, [], `session_id leaked to a third party: ${thirdPartyLeak.join(', ')}`);
});

test('report access token never appears in any outgoing GA-bound request on /report/:id', async () => {
  const reportId = 'rep_FAKEREPORT_xyz789';
  const { requestUrls } = await loadAndInspect(`/report/${reportId}`);
  const leakedToGa = requestUrls.filter((u) => GA_HOST_PATTERN.test(u) && u.includes(reportId));
  assert.deepEqual(leakedToGa, []);
});

const PUBLIC_ROUTES = ['/', '/wrapped', '/example', '/example2'];

for (const route of PUBLIC_ROUTES) {
  test(`GA still initializes on public page ${route}`, async () => {
    const { requestUrls, gtagType, dataLayerLen } = await loadAndInspect(route);
    const gaRequests = requestUrls.filter((u) => GA_HOST_PATTERN.test(u));
    assert.ok(gaRequests.length > 0, `expected a GA request on ${route}, got none`);
    assert.equal(gtagType, 'function', `expected window.gtag to be defined on ${route}`);
    assert.ok(dataLayerLen > 0, `expected dataLayer to have entries on ${route}`);
  });
}

test('checkout_click event on the landing page carries no PII', async () => {
  const page = await browser.newPage();
  // Without a configured Stripe key, clicking checkout fails server-side
  // and the page falls into `alert(...)` — auto-dismiss it so it doesn't
  // block the page (and this test) waiting for a human to click OK.
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.__events = [];
    const orig = window.gtag;
    window.gtag = function (...args) {
      window.__events.push(args);
      return orig.apply(this, args);
    };
  });
  await page.click('#hero-checkout-btn').catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const events = await page.evaluate(() => window.__events);
  await page.close();

  const checkoutEvents = events.filter((e) => e[0] === 'event' && e[1] === 'checkout_click');
  assert.ok(checkoutEvents.length > 0, 'expected a checkout_click event to fire on click');
  for (const e of checkoutEvents) {
    const payload = e[2] || {};
    const keys = Object.keys(payload);
    assert.deepEqual(keys, ['button_id'], `checkout_click payload should only contain button_id, got: ${keys.join(', ')}`);
    assert.doesNotMatch(String(payload.button_id), /@/, 'button_id should not look like an email');
  }
});

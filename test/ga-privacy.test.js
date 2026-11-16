// Privacy tests for GA4 and the TikTok pixel.
//
// /app?session_id=... and /report/:id carry a Stripe checkout session id or
// a report access token. Both trackers send the full URL, so those pages
// must sanitize the address bar (scripts/sanitize-url.js) before either
// script loads, pin GA4 page_location to the clean URL, and never put the
// secret in a tracker request. Public marketing pages must keep tracking,
// and the checkout_click event must stay free of PII.
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
const TIKTOK_HOST_PATTERN = /analytics\.tiktok\.com|tiktokw\.us|tiktokv\.com/;
const TRACKER_HOST_PATTERN = new RegExp(GA_HOST_PATTERN.source + '|' + TIKTOK_HOST_PATTERN.source);

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

function requestBlob(req) {
  const parts = [req.url()];
  try {
    const post = req.postData();
    if (post) parts.push(post);
  } catch (e) {}
  const headers = req.headers();
  if (headers.referer) parts.push(headers.referer);
  return parts.join('\n');
}

async function loadAndInspect(urlPath) {
  const page = await browser.newPage();
  const requestUrls = [];
  let firstTrackerFrameUrl = null;
  page.on('request', (req) => {
    const url = req.url();
    requestUrls.push(requestBlob(req));
    if (!firstTrackerFrameUrl && TRACKER_HOST_PATTERN.test(url)) {
      try { firstTrackerFrameUrl = req.frame() ? req.frame().url() : ''; }
      catch (e) { firstTrackerFrameUrl = ''; }
    }
  });
  await page.goto(BASE + urlPath, { waitUntil: 'domcontentloaded', timeout: 15000 });
  // Give script-injected tracker beacons a moment to show up.
  await new Promise((r) => setTimeout(r, 1000));
  const snapshot = await page.evaluate(() => {
    const layer = [];
    const dl = window.dataLayer || [];
    for (let i = 0; i < dl.length; i++) {
      const entry = [];
      for (let j = 0; j < dl[i].length; j++) entry.push(dl[i][j]);
      layer.push(entry);
    }
    return {
      gtagType: typeof window.gtag,
      dataLayerLen: dl.length,
      ttqType: typeof window.ttq,
      pageUrl: location.pathname + location.search + location.hash,
      dataLayer: layer,
    };
  });
  await page.close();
  return { requestUrls, firstTrackerFrameUrl, ...snapshot };
}

const SENSITIVE_ROUTES = [
  ['/app', 'no query', null],
  ['/app?session_id=cs_test_FAKESESSION_abc123', 'Stripe session_id', 'cs_test_FAKESESSION_abc123'],
  ['/report', 'no id', null],
  ['/report/rep_FAKEREPORT_xyz789', 'report access token', 'rep_FAKEREPORT_xyz789'],
];

for (const [route, label, secret] of SENSITIVE_ROUTES) {
  test(`trackers load only after the URL is sanitized on ${route} (${label})`, async () => {
    const result = await loadAndInspect(route);
    assert.equal(result.gtagType, 'function', `expected GA after sanitize on ${route}`);
    assert.equal(result.ttqType, 'object', `expected TikTok after sanitize on ${route}`);
    assert.ok(result.dataLayerLen > 0, `expected a GA dataLayer on ${route}`);
    assert.ok(!result.pageUrl.includes('?'), `query left in the address bar on ${route}: ${result.pageUrl}`);
    assert.ok(!result.pageUrl.includes('#'), `hash left in the address bar on ${route}: ${result.pageUrl}`);
    assert.ok(result.pageUrl === '/app' || result.pageUrl === '/report', `unexpected URL ${result.pageUrl}`);

    const config = result.dataLayer.find((entry) => entry[0] === 'config' && entry[1] === 'G-097G9EFFM6');
    assert.ok(config, `expected a GA4 config on ${route}`);
    const pageLocation = config[2] && config[2].page_location;
    assert.equal(typeof pageLocation, 'string');
    assert.match(pageLocation, /\/(app|report)$/);
    assert.ok(!/[?#]/.test(pageLocation), `page_location is not the clean URL: ${pageLocation}`);

    if (secret) {
      assert.ok(!result.pageUrl.includes(secret));
      assert.ok(!pageLocation.includes(secret));
      assert.ok(result.firstTrackerFrameUrl, `expected a tracker request on ${route}`);
      assert.ok(
        !result.firstTrackerFrameUrl.includes(secret),
        `tracker requested while the document URL still held the secret: ${result.firstTrackerFrameUrl}`
      );
      assert.ok(!/[?&]session_id=|[?&]payment_intent=/.test(result.firstTrackerFrameUrl));
      const leaked = result.requestUrls.filter((u) => TRACKER_HOST_PATTERN.test(u) && u.includes(secret));
      assert.deepEqual(leaked, [], `secret leaked to a tracker on ${route}: ${leaked.join(' | ')}`);
    }
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

test('report access token never appears in a TikTok request on /report/:id', async () => {
  const reportId = 'rep_FAKEREPORT_xyz789';
  const { requestUrls } = await loadAndInspect(`/report/${reportId}`);
  const leakedToTikTok = requestUrls.filter((u) => TIKTOK_HOST_PATTERN.test(u) && u.includes(reportId));
  assert.deepEqual(leakedToTikTok, []);
});

const PUBLIC_ROUTES = [
  '/',
  '/wrapped',
  '/example',
  '/example2',
  '/landing-amber.html',
  '/songs/hotel-california-meaning',
  '/songs/billie-jean-meaning',
  '/songs/matadora-karol-g-meaning',
];

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

for (const route of PUBLIC_ROUTES) {
  test(`TikTok pixel loads on public page ${route}`, async () => {
    const { requestUrls, ttqType } = await loadAndInspect(route);
    assert.equal(ttqType, 'object', `expected window.ttq on ${route}`);
    const tiktokRequests = requestUrls.filter((u) => TIKTOK_HOST_PATTERN.test(u));
    assert.ok(tiktokRequests.length > 0, `expected a TikTok request on ${route}, got none`);
    assert.ok(
      tiktokRequests.some((u) => u.includes('DBTOD4BC77U11P3NNC30')),
      `expected the pixel id on a TikTok request for ${route}`
    );
  });
}

test('checkout button fires begin_checkout and InitiateCheckout without the session id', async () => {
  const page = await browser.newPage();
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  // Keep the ttq stub in place. events.js replaces ttq.track when it loads,
  // which would drop a wrapper installed around the stub.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (TIKTOK_HOST_PATTERN.test(req.url())) {
      req.abort().catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.__events = [];
    const orig = window.gtag;
    window.gtag = function (...args) {
      window.__events.push(args);
      return orig.apply(this, args);
    };
  });
  const queuedBefore = await page.evaluate(() => (window.ttq || []).length);
  await page.click('#hero-checkout-btn').catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const captured = await page.evaluate((start) => {
    const ttq = [];
    const q = window.ttq || [];
    for (let i = start; i < q.length; i++) {
      if (q[i] && q[i][0] === 'track') ttq.push(q[i]);
    }
    return { ga: window.__events, ttq };
  }, queuedBefore);
  await page.close();

  const begin = captured.ga.filter((e) => e[0] === 'event' && e[1] === 'begin_checkout');
  assert.equal(begin.length, 1, 'expected one begin_checkout event');
  assert.equal(begin[0][2].value, 7.99);
  assert.equal(begin[0][2].currency, 'USD');
  assert.deepEqual(Object.keys(begin[0][2]).sort(), ['currency', 'value']);

  const initiate = captured.ttq.filter((e) => e[1] === 'InitiateCheckout');
  assert.equal(initiate.length, 1, 'expected one InitiateCheckout event');
  assert.deepEqual(initiate[0][2], {
    value: 7.99,
    currency: 'USD',
    content_type: 'product',
    content_id: 'drlyra-report',
  });
  const blob = JSON.stringify(captured);
  assert.ok(!blob.includes('session_id'));
  assert.ok(!blob.includes('cs_'));
});

test('a sanitized report link still loads that report after reload', async () => {
  const reportId = 'ab'.repeat(16);
  const page = await browser.newPage();
  const urls = [];
  page.on('request', (req) => urls.push(requestBlob(req)));
  await page.goto(`${BASE}/report/${reportId}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(urls.some((u) => u.includes(`/api/report/${reportId}`)), 'expected the report fetch to keep the id');
  assert.equal(await page.evaluate(() => location.pathname + location.search), '/report');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('drlyra_report_route_id')), reportId);

  urls.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await page.evaluate(() => location.pathname + location.search), '/report');
  assert.ok(urls.some((u) => u.includes(`/api/report/${reportId}`)), 'reload lost the report id');
  const leaked = urls.filter((u) => TRACKER_HOST_PATTERN.test(u) && u.includes(reportId));
  assert.deepEqual(leaked, []);
  await page.close();
});

test('purchase and CompletePayment fire once after a verified Stripe session', async () => {
  const token = 'cs_test_FAKESESSION_purchase_once';
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/verify-session')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ paid: true, email: null }),
      }).catch(() => {});
      return;
    }
    if (TRACKER_HOST_PATTERN.test(url)) {
      req.abort().catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });

  await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });

  async function countEvents() {
    return page.evaluate(() => {
      const purchases = [];
      const dl = window.dataLayer || [];
      for (let i = 0; i < dl.length; i++) {
        const entry = [];
        for (let j = 0; j < dl[i].length; j++) entry.push(dl[i][j]);
        if (entry[0] === 'event' && entry[1] === 'purchase') purchases.push(entry[2] || {});
      }
      const payments = [];
      const q = window.ttq || [];
      for (let i = 0; i < q.length; i++) {
        const item = q[i];
        if (item && item[0] === 'track' && item[1] === 'CompletePayment') payments.push(item[2] || {});
      }
      return { purchases, payments, pageUrl: location.pathname + location.search + location.hash };
    });
  }

  await page.goto(`${BASE}/app?session_id=${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const dl = window.dataLayer || [];
    for (let i = 0; i < dl.length; i++) {
      if (dl[i] && dl[i][0] === 'event' && dl[i][1] === 'purchase') return true;
    }
    return false;
  }, { timeout: 8000 });
  const first = await countEvents();
  assert.equal(first.pageUrl, '/app');
  assert.equal(first.purchases.length, 1);
  assert.equal(first.payments.length, 1);
  assert.equal(first.purchases[0].value, 7.99);
  assert.equal(first.purchases[0].currency, 'USD');
  assert.ok(first.purchases[0].transaction_id, 'expected a short transaction_id');
  assert.notEqual(first.purchases[0].transaction_id, token);
  assert.ok(!token.includes(first.purchases[0].transaction_id));
  assert.ok(!JSON.stringify(first).includes(token));
  assert.deepEqual(first.payments[0], {
    value: 7.99,
    currency: 'USD',
    content_type: 'product',
    content_id: 'drlyra-report',
  });

  await page.evaluate((sessionId) => window.drLyraTrackPurchase(sessionId), token);
  const again = await countEvents();
  assert.equal(again.purchases.length, 1, 'a second purchase call in the same page fired again');
  assert.equal(again.payments.length, 1, 'a second CompletePayment call in the same page fired again');

  await page.goto(`${BASE}/app?session_id=${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    return performance.getEntriesByType('resource').some((entry) => entry.name.includes('/verify-session'));
  }, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 300));
  const second = await countEvents();
  assert.equal(second.pageUrl, '/app');
  assert.equal(second.purchases.length, 0, 'purchase fired again on a second visit in the same tab');
  assert.equal(second.payments.length, 0, 'CompletePayment fired again on a second visit in the same tab');
  await page.close();
});

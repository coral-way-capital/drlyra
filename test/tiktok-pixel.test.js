// Static checks for the TikTok pixel include and the sanitize-before-track
// order. These do not boot a browser; the runtime privacy checks live in
// test/ga-privacy.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PIXEL_ID = 'DBTOD4BC77U11P3NNC30';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('tiktok.js is the only source of the pixel id and loads it with ttq.page()', () => {
  const tiktok = read('scripts/tiktok.js');
  assert.match(tiktok, new RegExp(PIXEL_ID));
  assert.match(tiktok, /ttq\.load\(PIXEL_ID\)/);
  assert.match(tiktok, /ttq\.page\(\)/);
  assert.match(tiktok, /urlStillHasSecret/);
  assert.match(tiktok, /InitiateCheckout/);
  assert.match(tiktok, /CompletePayment/);
  assert.match(tiktok, /begin_checkout/);
  assert.match(tiktok, /'purchase'/);
  assert.match(tiktok, /drlyra_purchase_tracked/);

  const textFiles = walk(ROOT).filter((file) => /\.(html|js|css|json|md)$/.test(file));
  const hits = textFiles
    .filter((file) => !file.startsWith(path.join(ROOT, 'test') + path.sep))
    .filter((file) => fs.readFileSync(file, 'utf8').includes(PIXEL_ID))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(hits, [path.join('scripts', 'tiktok.js')]);
});

test('the server does not call the TikTok Events API', () => {
  const server = read('server.js');
  assert.ok(!server.includes('business-api.tiktok.com'));
  assert.ok(!server.includes(PIXEL_ID));
  assert.ok(!/tiktok/i.test(server));
});

test('tiktok.js is included on every page that includes ga.js or utm.js, plus /app, /report, and /songs', () => {
  const htmlFiles = walk(ROOT).filter((file) => file.endsWith('.html'));
  const included = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const hasGa = html.includes('src="/scripts/ga.js"');
    const hasUtm = html.includes('src="/scripts/utm.js"');
    const isSong = rel.startsWith('songs' + path.sep);
    const isAppOrReport = rel === 'index.html' || rel === 'report.html';
    if (hasGa || hasUtm || isSong || isAppOrReport) {
      assert.ok(html.includes('src="/scripts/tiktok.js"'), `${rel} is missing tiktok.js`);
      included.push(rel);
    }
  }
  for (const rel of [
    'landing.html',
    'landing-wrapped.html',
    'landing-amber.html',
    'index.html',
    'report.html',
    'example-report.html',
    'example-report-2.html',
    path.join('songs', 'hotel-california-meaning.html'),
    path.join('songs', 'billie-jean-meaning.html'),
    path.join('songs', 'matadora-karol-g-meaning.html'),
  ]) {
    assert.ok(included.includes(rel), rel);
  }
});

test('/app and /report sanitize the URL before either tracker script', () => {
  for (const rel of ['index.html', 'report.html']) {
    const html = read(rel);
    const sanitize = html.indexOf('src="/scripts/sanitize-url.js"');
    const ga = html.indexOf('src="/scripts/ga.js"');
    const tt = html.indexOf('src="/scripts/tiktok.js"');
    assert.ok(sanitize !== -1, `${rel} is missing sanitize-url.js`);
    assert.ok(ga !== -1 && tt !== -1, `${rel} is missing a tracker`);
    assert.ok(sanitize < ga, `${rel} includes ga.js before sanitize-url.js`);
    assert.ok(sanitize < tt, `${rel} includes tiktok.js before sanitize-url.js`);
  }
  const sanitize = read('scripts/sanitize-url.js');
  assert.match(sanitize, /history\.replaceState\(\{\}, '', '\/app'\)/);
  assert.match(sanitize, /history\.replaceState\(\{\}, '', '\/report'\)/);
  assert.match(sanitize, /drlyra_checkout_session_id/);
  assert.match(sanitize, /drlyra_report_route_id/);

  const ga = read('scripts/ga.js');
  assert.match(ga, /'\/app'/);
  assert.match(ga, /'\/report'/);
  assert.match(ga, /page_location/);
  assert.match(ga, /urlStillHasSecret/);
  assert.match(ga, /sanitized/i);
});

test('checkout buttons fire InitiateCheckout and begin_checkout, and /app purchases only after verify-session', () => {
  for (const rel of ['landing.html', 'landing-wrapped.html', 'landing-amber.html']) {
    const html = read(rel);
    assert.match(html, /drLyraTrackInitiateCheckout/);
  }
  const app = read('index.html');
  const verifyAt = app.indexOf('/verify-session?session_id=');
  const purchaseAt = app.indexOf('drLyraTrackPurchase');
  assert.ok(verifyAt !== -1 && purchaseAt !== -1);
  assert.ok(verifyAt < purchaseAt, 'purchase is recorded before the verify-session call');
  assert.match(app, /data\.paid[\s\S]{0,240}drLyraTrackPurchase/);
});

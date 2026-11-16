// Google Analytics (GA4) — single source of truth for the Measurement ID.
// Public marketing pages include this with one line:
//   <script src="/scripts/ga.js"></script>
//
// GA4's automatic page_view event sends the full page URL — including the
// query string — to Google. /report/:id carries a report access token and
// /app?session_id=... carries a Stripe checkout session id, so this file
// must not request gtag.js while either secret is still in the URL.
//
// This is an ALLOWLIST, not a blocklist: only known-public paths, plus
// /app and /report after they have been sanitized, are enabled. A future
// sensitive route is excluded by default. scripts/sanitize-url.js runs
// first on /app and /report, stashes the id the page needs, and
// history.replaceState's the address bar to exactly /app or /report with
// an empty query. /app and /report are on the allowlist only for that
// sanitized flow. If the token or session_id is still present, we return
// before gtag exists and before the gtag.js request is made. page_location
// is pinned to the clean URL so the hit cannot carry the pre-replace URL.
(function () {
  const MEASUREMENT_ID = 'G-097G9EFFM6';
  const PUBLIC_PATHS = [
    '/',
    '/wrapped',
    '/example',
    '/example2',
    // Song myth pages are public marketing pages. The URL has no report
    // token or checkout session id, so GA4 may load here. The inline lead
    // form records which song was submitted via song_page_lead_submit.
    '/songs/hotel-california-meaning',
    '/songs/billie-jean-meaning',
    '/songs/matadora-karol-g-meaning',
    // Amber preview is a public marketing page with the same checkout
    // buttons and no report token or checkout session id.
    '/landing-amber.html',
    // Allowed only after sanitize-url.js has replaced the address bar.
    // A query string or a /report/:id path still holds a secret — refused
    // by urlStillHasSecret() below, so these two entries never track the
    // raw success URL or the report link.
    '/app',
    '/report',
  ];

  function urlStillHasSecret() {
    const path = window.location.pathname;
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    if (/^\/report\/.+/.test(path)) return true;
    if ((path === '/app' || path === '/report') && (search || /session_id|payment_intent/i.test(hash))) return true;
    if (/[?&#](?:session_id|payment_intent)=/i.test(search + hash)) return true;
    return false;
  }

  const path = window.location.pathname;
  if (urlStillHasSecret()) return;
  if (!PUBLIC_PATHS.includes(path)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { dataLayer.push(arguments); };
  gtag('js', new Date());

  if (path === '/app' || path === '/report') {
    // Pin the hit to the cleaned URL. Also drop any referrer path: the
    // Stripe Checkout return URL can embed a session id.
    let pageReferrer = '';
    try {
      if (document.referrer) pageReferrer = new URL(document.referrer).origin + '/';
    } catch (e) {}
    gtag('config', MEASUREMENT_ID, {
      page_location: window.location.origin + path,
      page_path: path,
      page_referrer: pageReferrer,
    });
  } else {
    gtag('config', MEASUREMENT_ID);
  }

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);
})();

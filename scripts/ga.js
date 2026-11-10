// Google Analytics (GA4) — single source of truth for the Measurement ID.
// Public marketing pages include this with one line:
//   <script src="/scripts/ga.js"></script>
//
// GA4's automatic page_view event sends the full page URL — including the
// query string — to Google. /report/:id and /app?session_id=... carry a
// report access token / Stripe checkout session id in that URL, so GA must
// never initialize (and the gtag.js request must never even fire) there.
//
// This is an ALLOWLIST, not a blocklist: only known-public, no-user-data
// pages are enabled. A future sensitive route is excluded by default
// instead of relying on someone remembering to add it to an exclusion
// list. /report, /report/:id, and /app are intentionally absent — and so
// is anything not explicitly listed here.
(function () {
  const PUBLIC_PATHS = ['/', '/wrapped', '/example', '/example2'];
  if (!PUBLIC_PATHS.includes(window.location.pathname)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', 'G-097G9EFFM6');

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-097G9EFFM6';
  document.head.appendChild(s);
})();

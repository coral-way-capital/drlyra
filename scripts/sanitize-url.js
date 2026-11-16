// Runs synchronously before ga.js and tiktok.js on /app and /report.
//
// GA4 and the TikTok pixel both send the full page URL. /app is the Stripe
// success_url (/app?session_id={CHECKOUT_SESSION_ID}) and /report/:id carries
// a private report access token. Read the value the page needs, stash it in
// sessionStorage (so a reload of the cleaned URL still works), then
// history.replaceState to a clean URL. Trackers are included after this
// script and must not run until that replace has happened.
//
// If sessionStorage is unavailable, leave the URL alone. The page can still
// read the id from the address bar, and ga.js / tiktok.js refuse to load
// while a secret is still in the URL.
(function () {
  var path = window.location.pathname;
  var params = new URLSearchParams(window.location.search);

  function storageWorks() {
    try {
      var probe = '__drlyra_ss_probe';
      sessionStorage.setItem(probe, '1');
      sessionStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  function stash(key, value) {
    if (!value) return;
    try { sessionStorage.setItem(key, value); } catch (e) {}
  }

  function decodePart(value) {
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  if (!storageWorks()) return;

  if (path === '/app') {
    stash('drlyra_checkout_session_id', params.get('session_id'));
    stash('drlyra_payment_intent_id', params.get('payment_intent'));
    stash('drlyra_redirect_status', params.get('redirect_status'));
    stash('drlyra_access_code', params.get('code'));
    if (window.location.search || window.location.hash) {
      history.replaceState({}, '', '/app');
    }
    return;
  }

  var reportMatch = path.match(/^\/report\/([^/]+)\/?$/);
  if (reportMatch) {
    stash('drlyra_report_route_id', decodePart(reportMatch[1]));
    history.replaceState({}, '', '/report');
  } else if (path === '/report' && (window.location.search || window.location.hash)) {
    history.replaceState({}, '', '/report');
  }
})();

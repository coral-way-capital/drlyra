// TikTok Pixel — single source for pixel DBTOD4BC77U11P3NNC30.
// Pages include this with one line, after scripts/sanitize-url.js on
// /app and /report:
//   <script src="/scripts/tiktok.js"></script>
//
// The pixel sends the page URL on ttq.page() and on every track() call.
// Do not load it while a report token or Stripe session_id is still in
// the URL. There is no Events API call in this file.
(function () {
  var PIXEL_ID = 'DBTOD4BC77U11P3NNC30';
  var COMMERCE = {
    value: 7.99,
    currency: 'USD',
    content_type: 'product',
    content_id: 'drlyra-report',
  };
  var PURCHASE_GUARD = 'drlyra_purchase_tracked';

  function urlStillHasSecret() {
    var path = window.location.pathname;
    var search = window.location.search || '';
    var hash = window.location.hash || '';
    if (/^\/report\/.+/.test(path)) return true;
    if ((path === '/app' || path === '/report') && (search || /session_id|payment_intent/i.test(hash))) return true;
    if (/[?&#](?:session_id|payment_intent)=/i.test(search + hash)) return true;
    return false;
  }

  // Short non-reversible stand-in. Never the raw Stripe session id.
  function shortTrackingId(value) {
    var h = 2166136261;
    var s = String(value);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  window.drLyraTrackInitiateCheckout = function () {
    if (urlStillHasSecret()) return;
    if (window.ttq && typeof window.ttq.track === 'function') {
      window.ttq.track('InitiateCheckout', COMMERCE);
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'begin_checkout', {
        value: COMMERCE.value,
        currency: COMMERCE.currency,
      });
    }
  };

  // Once per tab session. Call only after the server has verified the
  // Stripe Checkout session as paid. sessionId is hashed locally and is
  // not sent to TikTok; GA4 receives the hash as transaction_id, or no
  // transaction_id if that hash would still reveal the raw id.
  window.drLyraTrackPurchase = function (sessionId) {
    if (urlStillHasSecret()) return;
    try {
      if (sessionStorage.getItem(PURCHASE_GUARD) === '1') return;
      sessionStorage.setItem(PURCHASE_GUARD, '1');
    } catch (e) {}
    if (window.ttq && typeof window.ttq.track === 'function') {
      window.ttq.track('CompletePayment', COMMERCE);
    }
    if (typeof window.gtag === 'function') {
      var purchase = { value: COMMERCE.value, currency: COMMERCE.currency };
      if (sessionId) {
        var hashed = shortTrackingId(sessionId);
        if (hashed && String(sessionId).indexOf(hashed) === -1) purchase.transaction_id = hashed;
      }
      window.gtag('event', 'purchase', purchase);
    }
  };

  if (urlStillHasSecret()) return;

  !function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = w[t] = w[t] || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    ttq.setAndDefer = function (t, e) {
      t[e] = function () {
        t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) {
      for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
      return e;
    };
    ttq.load = function (e, n) {
      var r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._i = ttq._i || {};
      ttq._i[e] = [];
      ttq._i[e]._u = r;
      ttq._t = ttq._t || {};
      ttq._t[e] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[e] = n || {};
      n = document.createElement('script');
      n.type = 'text/javascript';
      n.async = true;
      n.src = r + '?sdkid=' + e + '&lib=' + t;
      e = document.getElementsByTagName('script')[0];
      e.parentNode.insertBefore(n, e);
    };

    ttq.load(PIXEL_ID);
    ttq.page();
  }(window, document, 'ttq');
})();

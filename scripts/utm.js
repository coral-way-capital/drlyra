// First-touch UTM capture. Include after ga.js on every public page.
// Saves utm_* from the landing URL once; later pages reuse localStorage.
(function () {
  var KEY = 'drlyra_utm_first';
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function readStored() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function fromUrl() {
    var p = new URLSearchParams(window.location.search);
    var out = {};
    var any = false;
    KEYS.forEach(function (k) {
      var v = p.get(k);
      if (v) { out[k] = v; any = true; }
    });
    return any ? out : null;
  }

  if (!readStored()) {
    var found = fromUrl();
    if (found) {
      found.capturedAt = new Date().toISOString();
      found.landingPath = window.location.pathname + window.location.search;
      try { localStorage.setItem(KEY, JSON.stringify(found)); } catch (e) {}
    }
  }

  window.getDrLyraUtm = function () {
    var stored = readStored();
    if (stored) {
      var clean = {};
      KEYS.forEach(function (k) { if (stored[k]) clean[k] = stored[k]; });
      return clean;
    }
    return fromUrl() || {};
  };
})();

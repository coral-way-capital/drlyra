// Lead form for the song myth pages. Same request, success path, and error
// path as the homepage form in landing.html (#lead-form): POST { email } to
// /submit-lead, then show the sample. The homepage keeps its own inline
// handler so its behavior does not change.
//
// /submit-lead only reads email and stores { email, createdAt }. It does not
// accept or persist source fields, so which song page the signup came from
// is recorded as a GA4 event instead of a lead column.
(function () {
  var form = document.getElementById('lead-form');
  if (!form || !form.dataset.song) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = document.getElementById('lead-btn');
    var msg = document.getElementById('lead-msg');
    var email = document.getElementById('lead-email').value;
    var song = form.dataset.song;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    if (typeof gtag === 'function') {
      gtag('event', 'song_page_cta_click', {
        song: song,
        page_path: location.pathname,
      });
    }
    try {
      var r = await fetch('/submit-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      var data = await r.json();
      if (data.ok) {
        msg.textContent = '✓ Got it — opening your sample now…';
        msg.style.color = '#1DB954';
        form.style.display = 'none';
        if (typeof gtag === 'function') {
          gtag('event', 'song_page_lead_submit', {
            song: song,
            page_path: location.pathname,
          });
        }
        setTimeout(function () { window.location.href = '/example'; }, 700);
      } else {
        throw new Error('Failed');
      }
    } catch (err) {
      msg.textContent = 'Something went wrong. Try again.';
      msg.style.color = '#f87171';
      btn.disabled = false;
      btn.textContent = 'Send it';
    }
  });
})();

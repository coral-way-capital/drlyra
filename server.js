require('dotenv').config();
const express  = require('express');
const multer   = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const Stripe   = require('stripe');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendReportEmail(toEmail, reportId) {
  if (!resend) return;
  const reportUrl = `${process.env.APP_URL || 'http://localhost:3000'}/report/${reportId}`;
  const { error } = await resend.emails.send({
    from: process.env.FROM_EMAIL || 'Dr. Lyra <onboarding@resend.dev>',
    to: toEmail,
    subject: 'Your Dr. Lyra Psychological Profile is ready 🎵',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0a0f;color:#e0e0e0;border-radius:16px;">
        <div style="font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#1DB954;margin-bottom:24px;">Dr. Lyra</div>
        <h1 style="font-size:24px;font-weight:800;color:#fff;margin:0 0 16px;line-height:1.2;">Your Spotify Psychological Profile is ready.</h1>
        <p style="font-size:15px;color:#888;line-height:1.7;margin:0 0 32px;">Dr. Lyra has decoded your music taste into a 9-section psychological portrait. Some of it will surprise you.</p>
        <a href="${reportUrl}" style="display:inline-block;padding:14px 28px;background:#1DB954;color:#000;font-weight:700;font-size:15px;border-radius:10px;text-decoration:none;">Read Your Profile →</a>
        <p style="font-size:12px;color:#444;margin-top:32px;">Or copy this link: ${reportUrl}</p>
      </div>`,
  });
  if (error) throw new Error(error.message);
}

// ── Persistent data storage ──────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const LEADS_FILE   = path.join(DATA_DIR, 'leads.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
function readJSON(fp)    { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return {}; } }
function writeJSON(fp,d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2)); }

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: 20 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname), { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

const NO_CACHE = { headers: { 'Cache-Control': 'no-store' } };

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'landing.html'), NO_CACHE));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'index.html'), NO_CACHE));
app.get('/report', (req, res) => res.sendFile(path.join(__dirname, 'report.html'), NO_CACHE));
app.get('/report/:id', (req, res) => res.sendFile(path.join(__dirname, 'report.html'), NO_CACHE));
app.get('/example', (req, res) => res.sendFile(path.join(__dirname, 'example-report.html'), NO_CACHE));
app.get('/example2', (req, res) => res.sendFile(path.join(__dirname, 'example-report-2.html'), NO_CACHE));
app.get('/design-library', (req, res) => res.sendFile(path.join(__dirname, 'design-library.html'), NO_CACHE));

// ── Report storage ────────────────────────────────────────────────────────────
app.post('/save-report', async (req, res) => {
  const { text, email } = req.body;
  if (!text || text.length < 100) return res.status(400).json({ error: 'Invalid report' });
  const id = crypto.randomBytes(18).toString('hex');
  const reports = readJSON(REPORTS_FILE);
  reports[id] = { text, email: email || null, createdAt: new Date().toISOString() };
  writeJSON(REPORTS_FILE, reports);
  res.json({ id });
  if (email) sendReportEmail(email, id).catch(err => console.error('Email error:', err));
});

app.get('/api/report/:id', (req, res) => {
  const reports = readJSON(REPORTS_FILE);
  const report  = reports[req.params.id];
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json({ text: report.text });
});

// ── Lead capture ──────────────────────────────────────────────────────────────
app.post('/submit-lead', (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  const leads = readJSON(LEADS_FILE);
  const existing = Object.values(leads).find(l => l.email === email.toLowerCase());
  if (existing) return res.json({ ok: true, existing: true });
  leads[Date.now()] = { email: email.toLowerCase().trim(), createdAt: new Date().toISOString() };
  writeJSON(LEADS_FILE, leads);
  res.json({ ok: true });
});

// ── Admin (HTTP Basic Auth) ───────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const pass   = process.env.ADMIN_PASSWORD || 'drlyra2026';
  const expected = 'Basic ' + Buffer.from('admin:' + pass).toString('base64');
  if (req.headers.authorization !== expected) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Dr. Lyra Admin"');
    return res.status(401).send('Unauthorized');
  }
  const reports = readJSON(REPORTS_FILE);
  const leads   = readJSON(LEADS_FILE);
  const rList   = Object.entries(reports).sort((a,b)=>b[1].createdAt.localeCompare(a[1].createdAt)).slice(0,50);
  const lList   = Object.values(leads).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const rRows   = rList.map(([id,r]) => `<tr><td>${r.email || '<span style="color:#ccc">—</span>'}</td><td><code>${id.slice(0,12)}…</code></td><td>${r.createdAt.slice(0,16).replace('T',' ')}</td><td><a href="/report/${id}" target="_blank">View</a></td></tr>`).join('');
  const lRows   = lList.map(l => `<tr><td>${l.email}</td><td>${l.createdAt.slice(0,16).replace('T',' ')}</td></tr>`).join('');
  res.send(`<!DOCTYPE html><html><head><title>Dr. Lyra Admin</title><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#f5f5f5;padding:32px;color:#333}
    h1{font-size:1.3rem;font-weight:700;margin-bottom:24px}h2{font-size:1rem;font-weight:600;margin-bottom:12px}
    .stats{display:flex;gap:20px;margin-bottom:24px}.stat{background:#fff;border-radius:10px;padding:20px 28px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
    .stat-n{font-size:2.2rem;font-weight:800;color:#1DB954}.stat-l{font-size:12px;color:#888;margin-top:2px}
    .card{background:#fff;border-radius:10px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
    table{width:100%;border-collapse:collapse}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:13px}
    th{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#aaa}a{color:#1DB954}
  </style></head><body>
  <h1>Dr. Lyra — Admin</h1>
  <div class="stats">
    <div class="stat"><div class="stat-n">${Object.keys(reports).length}</div><div class="stat-l">Reports Generated</div></div>
    <div class="stat"><div class="stat-n">${lList.length}</div><div class="stat-l">Email Leads</div></div>
  </div>
  ${lList.length ? `<div class="card"><h2>Email Leads</h2><table><tr><th>Email</th><th>Date</th></tr>${lRows}</table></div>` : ''}
  ${rList.length ? `<div class="card"><h2>Buyers / Reports</h2><table><tr><th>Email</th><th>ID</th><th>Date</th><th></th></tr>${rRows}</table></div>` : ''}
  </body></html>`);
});

app.get('/test-email', async (req, res) => {
  const to = req.query.to;
  if (!to) return res.status(400).send('Missing ?to=email');
  if (!mailer) return res.status(503).send('SMTP not configured');
  try {
    await sendReportEmail(to, 'test-preview-id');
    res.send(`✓ Email sent to ${to}`);
  } catch (err) {
    res.status(500).send('Failed: ' + err.message);
  }
});

app.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

app.post('/create-payment-intent', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to .env' });
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 799,
      currency: 'usd',
      payment_method_types: ['card'],
      description: 'Dr. Lyra — Full Psychological Profile',
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/verify-payment', async (req, res) => {
  if (!stripe) return res.status(503).json({ paid: false });
  const { payment_intent_id } = req.query;
  if (!payment_intent_id) return res.status(400).json({ paid: false });
  try {
    const intent = await stripe.paymentIntents.retrieve(payment_intent_id);
    res.json({ paid: intent.status === 'succeeded' });
  } catch (err) {
    res.status(400).json({ paid: false });
  }
});

app.post('/create-checkout-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to .env' });
  const baseUrl = req.body.origin || `${req.protocol}://${req.get('host')}`;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Dr. Lyra — Full Psychological Profile',
            description: '9-section Spotify Psychological Profile report',
          },
          unit_amount: 799,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${baseUrl}/app?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/verify-session', async (req, res) => {
  if (!stripe) return res.status(503).json({ paid: false, error: 'Stripe not configured' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ paid: false });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({ paid: session.payment_status === 'paid' });
  } catch (err) {
    res.status(400).json({ paid: false });
  }
});

app.post('/analyze', upload.array('images', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded.' });
  }

  const imageContent = req.files.map(file => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: file.mimetype,
      data: file.buffer.toString('base64'),
    },
  }));

  const introText = {
    type: 'text',
    text: `I'm going to share my Spotify data with you. Generate a full Psychological Profile Report based on my music listening patterns. Not a generic horoscope — hyper-personal, specific, backed by real music psychology.

Here is my Spotify data:`,
  };

  const isFree = req.body.free === 'true';

  const instructionText = isFree ? {
    type: 'text',
    text: `Generate only the first section of the psychological profile report. Use this exact header so the app can parse it:

🎭 YOUR CORE PERSONALITY ARCHETYPE — Assign a named archetype (e.g. The Romantic Escapist, The Controlled Dreamer). Explain in 2–3 rich paragraphs referencing the specific artists and genres from the data. Open with the archetype name on its own line in bold. Make it feel like a revelation.

Stop after completing this section. Do not add any closing remarks or mention other sections.

Tone: Warm, intelligent, slightly theatrical. Like a trusted friend with a PhD in psychology and a Spotify addiction. Every insight must tie back to the actual data — use real artist and song names.`,
  } : {
    type: 'text',
    text: `Generate the full report with these exact 9 sections. Each section header must appear exactly as written below (emoji + title in caps), so the app can parse them correctly.

1. 🎭 YOUR CORE PERSONALITY ARCHETYPE — Assign a named archetype (e.g. The Romantic Escapist, The Controlled Dreamer). Explain in 2–3 rich paragraphs referencing my specific artists and genres. Open with the archetype name on its own line in bold. Make it feel like a revelation.

2. 🧠 YOUR EMOTIONAL LANDSCAPE — Analyze the emotional spectrum of my listening. Use music psychology (mood regulation theory, emotional contagion) to describe how I use music emotionally and what this reveals about how I process feelings in real life.

3. 🌙 YOUR SHADOW SELF — Look at contrasts, outliers, unexpected artists or genres. What do these contradictions reveal about the parts of me I don't always show? Be bold and specific.

4. 💡 YOUR COGNITIVE STYLE — Based on genre diversity or loyalty, tempo preferences, lyric-heavy vs instrumental choices: how does my mind work? Am I a big-picture thinker or detail-obsessed? Intuitive or analytical?

5. 🔥 YOUR DESIRE PROFILE — Based on the emotional register of my top music, what do I crave? Freedom, connection, intensity, control, beauty, chaos, belonging? Paint a portrait of my deepest motivations and what I am likely chasing in life right now.

6. 🌊 YOUR YEAR IN EMOTIONAL WAVES — Write a memoir-style narrative of my emotional arc as exactly 5 chapters. Write each movement complete with its full narrative before moving to the next — do NOT list all movement titles in advance. Use this exact format for each:

**Movement I: [Evocative Title]**
[2–3 paragraphs of vivid, personal emotional narrative]

**Movement II: [Evocative Title]**
[2–3 paragraphs]

Continue through **Movement V**. Five movements, no pre-outlining.

7. 🎯 YOUR BLIND SPOTS AND GROWTH EDGE — What does my music suggest I might be avoiding or not ready to face? Give exactly 3 musical recommendations (artist + starting point) with the psychological reason behind each.

8. ✨ YOUR MUSICAL SOULMATE PROFILE — Describe the kind of person who would be my perfect musical soulmate and my perfect musical nemesis. Make it playful but psychologically grounded.

9. 🏷️ YOUR SIGNATURE QUOTE — End with a single original quote, 1–2 sentences max, that captures the essence of who I am as revealed by my music. Something I could put on my wall.

Tone: Warm, intelligent, slightly theatrical. Like a trusted friend with a PhD in psychology and a Spotify addiction. Every insight must tie back to my specific data — use my actual artist and song names. Make me feel known.`,
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are Dr. Lyra — a witty, warm, and deeply insightful psychologist, musicologist, and behavioral analyst with 20 years of experience decoding the human psyche through the lens of music. You have a gift for making people feel deeply seen — not through cold clinical language, but through vivid, poetic, and eerily accurate observations that feel like someone finally put words to something the person always knew about themselves but could never articulate. Extract all visible data from the images first (artists, songs, genres, play counts, minutes, any stats shown), then generate the full psychological profile. If you cannot read certain parts clearly, work with what you can see and make smart inferences. Do not add any preamble before section 1 — start directly with the first section header.`,
      messages: [
        {
          role: 'user',
          content: [introText, ...imageContent, instructionText],
        },
      ],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Full error:', err);
    let message = err.message || 'Something went wrong.';
    // Anthropic SDK errors arrive as: "400 {\"type\":\"error\",\"error\":{\"message\":\"...\"}}"
    // Extract the human-readable message from that JSON blob
    try {
      const jsonStr = message.replace(/^\d+\s+/, '');
      const parsed = JSON.parse(jsonStr);
      if (parsed?.error?.message) message = parsed.error.message;
    } catch {}
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dr. Lyra is ready at http://localhost:${PORT}`));

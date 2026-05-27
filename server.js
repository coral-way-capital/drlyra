require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: 20 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname), { index: false }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/example', (req, res) => {
  res.sendFile(path.join(__dirname, 'example-report.html'));
});

app.get('/example2', (req, res) => {
  res.sendFile(path.join(__dirname, 'example-report-2.html'));
});

app.get('/design-library', (req, res) => {
  res.sendFile(path.join(__dirname, 'design-library.html'));
});

app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'report.html'));
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

  const instructionText = {
    type: 'text',
    text: `Generate the full report with these exact 9 sections. Each section header must appear exactly as written below (emoji + title in caps), so the app can parse them correctly.

1. 🎭 YOUR CORE PERSONALITY ARCHETYPE — Assign a named archetype (e.g. The Romantic Escapist, The Controlled Dreamer). Explain in 2–3 rich paragraphs referencing my specific artists and genres. Open with the archetype name on its own line in bold. Make it feel like a revelation.

2. 🧠 YOUR EMOTIONAL LANDSCAPE — Analyze the emotional spectrum of my listening. Use music psychology (mood regulation theory, emotional contagion) to describe how I use music emotionally and what this reveals about how I process feelings in real life.

3. 🌙 YOUR SHADOW SELF — Look at contrasts, outliers, unexpected artists or genres. What do these contradictions reveal about the parts of me I don't always show? Be bold and specific.

4. 💡 YOUR COGNITIVE STYLE — Based on genre diversity or loyalty, tempo preferences, lyric-heavy vs instrumental choices: how does my mind work? Am I a big-picture thinker or detail-obsessed? Intuitive or analytical?

5. 🔥 YOUR DESIRE PROFILE — Based on the emotional register of my top music, what do I crave? Freedom, connection, intensity, control, beauty, chaos, belonging? Paint a portrait of my deepest motivations and what I am likely chasing in life right now.

6. 🌊 YOUR YEAR IN EMOTIONAL WAVES — Write a memoir-style narrative of my emotional arc. Structure it as clearly labeled movements (e.g. Movement I: The Reconstruction, Movement II: The Discovery) with a short paragraph for each.

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

// BIO POP — Glitch server
// Serves the static page from /public and proxies /generate calls to Gemini

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const MODEL = 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

app.get('/health', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY;
  res.json({ ok: hasKey, model: MODEL, keyConfigured: hasKey });
});

app.post('/generate', async (req, res) => {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });
  }

  try {
    const { prompt, faceImageBase64, faceMimeType } = req.body;

    const parts = [{ text: prompt }];
    if (faceImageBase64) {
      parts.push({
        inline_data: {
          mime_type: faceMimeType || 'image/jpeg',
          data: faceImageBase64,
        },
      });
    }

    const requestBody = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    };

    console.log(`[${new Date().toISOString()}] Generating: "${prompt.slice(0, 80)}..."`);

    const apiResp = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await apiResp.json();

    if (!apiResp.ok) {
      console.error('Gemini API error:', JSON.stringify(data));
      return res.status(apiResp.status).json({
        error: data.error?.message || 'API error',
        detail: data,
      });
    }

    let imageBase64 = null;
    let imageMime = 'image/png';
    const candidates = data.candidates || [];
    for (const cand of candidates) {
      const cparts = cand.content?.parts || [];
      for (const p of cparts) {
        if (p.inline_data?.data || p.inlineData?.data) {
          imageBase64 = p.inline_data?.data || p.inlineData?.data;
          imageMime = p.inline_data?.mime_type || p.inlineData?.mimeType || 'image/png';
          break;
        }
      }
      if (imageBase64) break;
    }

    if (!imageBase64) {
      console.error('No image in response:', JSON.stringify(data).slice(0, 500));
      return res.status(500).json({ error: 'No image returned by model', detail: data });
    }

    console.log(`  -> ok (${Math.round(imageBase64.length / 1024)}kb)`);
    res.json({ imageBase64, mimeType: imageMime });
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BIO POP listening on port ${PORT}`);
});

// BIOPOP — Server (Render deploy)
// Serves the static page from /public AND proxies /generate to xAI's Grok Image API
// Render auto-runs this via package.json start script

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const MODEL = 'grok-imagine-image';
const GENERATIONS_ENDPOINT = 'https://api.x.ai/v1/images/generations';
const EDITS_ENDPOINT = 'https://api.x.ai/v1/images/edits';

app.get('/health', (req, res) => {
  const hasKey = !!process.env.XAI_API_KEY;
  res.json({ ok: hasKey, model: MODEL, keyConfigured: hasKey });
});

app.post('/generate', async (req, res) => {
  const API_KEY = process.env.XAI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'XAI_API_KEY not set in environment' });
  }

  try {
    const { prompt, faceImageBase64, faceMimeType } = req.body;

    let endpoint, requestBody;

    if (faceImageBase64) {
      // Image edit: transform an uploaded face per the prompt
      endpoint = EDITS_ENDPOINT;
      const dataUri = `data:${faceMimeType || 'image/jpeg'};base64,${faceImageBase64}`;
      requestBody = {
        model: MODEL,
        prompt: prompt,
        image: {
          url: dataUri,
          type: 'image_url',
        },
        response_format: 'b64_json',
      };
    } else {
      // Text-to-image: synthetic face generation
      endpoint = GENERATIONS_ENDPOINT;
      requestBody = {
        model: MODEL,
        prompt: prompt,
        response_format: 'b64_json',
      };
    }

    console.log(`[${new Date().toISOString()}] ${faceImageBase64 ? 'EDIT' : 'GENERATE'}: "${prompt.slice(0, 80)}..."`);

    const apiResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await apiResp.json();

    if (!apiResp.ok) {
      console.error('xAI API error:', JSON.stringify(data));
      return res.status(apiResp.status).json({
        error: data.error?.message || data.error || 'xAI API error',
        detail: data,
      });
    }

    let imageBase64 = null;
    let imageMime = 'image/jpeg';
    if (data.data && data.data[0]) {
      if (data.data[0].b64_json) {
        imageBase64 = data.data[0].b64_json;
      } else if (data.data[0].url) {
        // Fallback: fetch the URL and convert to base64
        const imgResp = await fetch(data.data[0].url);
        const buf = Buffer.from(await imgResp.arrayBuffer());
        imageBase64 = buf.toString('base64');
        const ct = imgResp.headers.get('content-type');
        if (ct) imageMime = ct;
      }
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
  console.log(`FRAUENKLAVIER listening on port ${PORT}`);
  console.log(`Model: ${MODEL}`);
});

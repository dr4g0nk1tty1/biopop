// FRAUENKLAVIER — Local Proxy Server
// Forwards browser requests to xAI's Grok Image API (grok-imagine-image)
// Run with: node server.js
//
// Setup:
//   1. Get an xAI API key at https://console.x.ai (requires billing setup)
//   2. Create a file called `.env` in the same folder as this server, with one line:
//        XAI_API_KEY=your_key_here
//   3. Run: node server.js
//   4. Open biopop.html (or index.html) in your browser. It talks to localhost:8787.

const http = require('http');
const fs = require('fs');
const path = require('path');

let API_KEY = process.env.XAI_API_KEY;
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/XAI_API_KEY\s*=\s*(.+)/);
    if (match) API_KEY = match[1].trim().replace(/^["']|["']$/g, '');
  }
} catch (e) {
  console.error('Could not read .env file:', e.message);
}

if (!API_KEY) {
  console.error('\nNo API key found.');
  console.error('Create a file called .env in this folder containing:');
  console.error('  XAI_API_KEY=your_key_here');
  console.error('Get an API key at https://console.x.ai (requires billing).\n');
  process.exit(1);
}

const PORT = 8787;
const MODEL = 'grok-imagine-image';
const GENERATIONS_ENDPOINT = 'https://api.x.ai/v1/images/generations';
const EDITS_ENDPOINT = 'https://api.x.ai/v1/images/edits';

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: MODEL }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { prompt, faceImageBase64, faceMimeType } = JSON.parse(body);

      let endpoint, requestBody;

      if (faceImageBase64) {
        // Image edit: transform an existing face according to the prompt
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
        // Pure text-to-image: synthetic face generation
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
        res.writeHead(apiResp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: data.error?.message || data.error || 'xAI API error',
          detail: data,
        }));
        return;
      }

      // xAI returns either b64_json or url. Prefer b64_json.
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
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No image returned by model', detail: data }));
        return;
      }

      console.log(`  -> ok (${Math.round(imageBase64.length / 1024)}kb)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ imageBase64, mimeType: imageMime }));
    } catch (err) {
      console.error('Proxy error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n  FRAUENKLAVIER proxy running on http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Endpoints: ${GENERATIONS_ENDPOINT} / ${EDITS_ENDPOINT}`);
  console.log(`  Open the website in your browser to begin.\n`);
});

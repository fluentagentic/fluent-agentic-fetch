// Fluent Agentic — Scoring Adjustment
// Server-side Claude call for pillar score adjustment
// Moves the direct browser API call to Vercel to avoid CORS/browser restrictions
//
// Usage: POST /api/score
// Body: { prompt }
// Headers: x-fetch-secret: your-secret

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fetch-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Secret key check
  const secret = process.env.FETCH_SECRET;
  if (secret && req.headers['x-fetch-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `Anthropic API error: ${response.status}`, detail: err.slice(0, 200) });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Score request timed out' });
    return res.status(502).json({ error: `Score failed: ${err.message}` });
  }
}

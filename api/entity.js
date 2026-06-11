// Fluent Agentic — Entity Presence Search
// Server-side Anthropic API call with web search tool
//
// SETUP: In Vercel dashboard → Settings → Environment Variables, add:
//   ANTHROPIC_API_KEY = your Anthropic API key
//   FETCH_SECRET = same secret as your fetch function
//
// Usage: POST /api/entity
// Body: { url, industry }
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

  const { url, industry } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const isRetail = industry === 'retail';
  const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();

  const prompt = `You are an AI agent verifying a business before recommending it to a user.

Search for this business: ${url}

Check these external sources and score how well this business can be found and verified by an AI agent:
- Google Maps / Google Business Profile
- TripAdvisor, Zomato, or Yelp ${isRetail ? '(or product review sites like ProductReview.com.au)' : ''}
- ${isRetail ? 'Google Shopping, product directories, stockist listings' : 'Booking platforms (OpenTable, ResDiary, SevenRooms, Dimmi)'}
- Editorial mentions, press coverage, awards, guides
- Consistency of business name, address, hours, and contact details across sources

For each source found, note: what information is available, rating/review count if present, and whether details are consistent with other sources.

Score entity presence 0-100:
- 0-20: Not findable from external sources
- 21-40: Minimal presence, inconsistent information  
- 41-60: Present on some platforms, some gaps
- 61-80: Good presence, reasonably consistent across sources
- 81-100: Strong verified presence across multiple authoritative sources

Return ONLY valid JSON on the first line (no markdown), then detailed findings:
{"entity_score":0,"sources_found":[],"sources_missing":[],"consistent":true,"source_details":{},"scoring_rationale":"","key_gaps":[],"key_strengths":[]}

source_details should be an object like: {"tripadvisor":"4.3/5 from 1575 reviews, #51 in Sydney","opentable":"563 verified diners"}
scoring_rationale should explain step by step why this score was given
key_gaps should list specific actionable things missing (max 3)
key_strengths should list what's working well (max 3)

Use these exact source names: google_maps, tripadvisor, opentable, zomato, yelp, editorial_mentions, booking_platform, product_reviews, google_shopping

After the JSON, write a detailed narrative paragraph (3-5 sentences) describing exactly what an AI agent would find when searching for this business.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

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
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `Anthropic API error: ${response.status}`, detail: err.slice(0, 200) });
    }

    const data = await response.json();

    // Extract text blocks from potentially multi-turn tool-use response
    const textBlocks = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const cleaned = textBlocks.replace(/```json|```/gi, '').trim();

    // Parse JSON from response
    let entityData = null;
    for (const m of [...cleaned.matchAll(/\{[^{}]{20,3000}\}/g)]) {
      try {
        const obj = JSON.parse(m[0]);
        if (typeof obj.entity_score === 'number') { entityData = obj; break; }
      } catch {}
    }

    if (!entityData) {
      return res.status(502).json({ error: 'Could not parse entity score from response', raw: cleaned.slice(0, 300) });
    }

    // Narrative is everything after the first JSON block
    const jsonEnd = cleaned.indexOf('}') + 1;
    const narrative = cleaned.slice(jsonEnd).trim().replace(/^[\n\r]+/, '');

    return res.status(200).json({
      ...entityData,
      narrative,
      usage: data.usage,
    });

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Entity search timed out' });
    return res.status(502).json({ error: `Search failed: ${err.message}` });
  }
}

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

  const prompt = `You are an AI agent verifying a business before recommending it.

Search for: ${url}

Check: Google Maps, TripAdvisor, ${isRetail ? 'product review sites, Google Shopping, directories' : 'OpenTable/booking platforms, Zomato'}, Yelp, editorial mentions, awards.

For each source found, note rating/review count and whether NAP (name, address, phone) is consistent.

Score 0-100: 0-20 not findable | 21-40 minimal | 41-60 moderate | 61-80 good | 81-100 strong verified presence

Return ONLY this JSON (no markdown, no preamble), then one concise paragraph:
{"entity_score":0,"sources_found":[],"sources_missing":[],"consistent":true,"source_details":{},"scoring_rationale":"2-3 sentences max — key reasons for score","key_gaps":[],"key_strengths":[]}

Rules:
- source_details: one line per source e.g. {"tripadvisor":"4.3/5, 1575 reviews, #51 Sydney"}
- scoring_rationale: 2-3 sentences only — conclusions not workings
- key_gaps: max 3 items, one line each
- key_strengths: max 3 items, one line each
- Narrative: 2-3 sentences — what would an agent find? Be specific, no padding.

Source names: google_maps, tripadvisor, opentable, zomato, yelp, editorial_mentions, booking_platform, product_reviews, google_shopping`;

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
        'anthropic-beta': 'token-efficient-tools-2025-02-19',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
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

    // Parse JSON — handle nested objects by finding balanced braces
    let entityData = null;
    let braceDepth = 0, jsonStart = -1;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        if (braceDepth === 0) jsonStart = i;
        braceDepth++;
      } else if (cleaned[i] === '}') {
        braceDepth--;
        if (braceDepth === 0 && jsonStart >= 0) {
          try {
            const candidate = cleaned.slice(jsonStart, i + 1);
            const obj = JSON.parse(candidate);
            if (typeof obj.entity_score === 'number') { entityData = obj; break; }
          } catch {}
          jsonStart = -1;
        }
      }
    }

    if (!entityData) {
      return res.status(502).json({ error: 'Could not parse entity score from response', raw: cleaned.slice(0, 300) });
    }

    // Narrative is everything after the JSON object
    let narrativeStart = 0;
    let depth = 0;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') { depth--; if (depth === 0) { narrativeStart = i + 1; break; } }
    }
    const narrative = cleaned.slice(narrativeStart).trim()
      .replace(/^[\n\r]+/, '')
      .replace(/\*\*[^*]+\*\*/g, s => s.slice(2, -2))  // remove bold **
      .replace(/\*([^*]+)\*/g, '$1')                    // remove italic *
      .replace(/^#+\s+/gm, '')                          // remove headings
      .replace(/^---+$/gm, '')                          // remove horizontal rules
      .replace(/\n{3,}/g, '\n\n')                       // collapse excess newlines
      .trim();

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

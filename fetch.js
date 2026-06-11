// Fluent Agentic — Server-side fetch function
// Deploy to Vercel. Replaces browser CORS proxies with a reliable server fetch.
//
// SETUP: In Vercel dashboard → Settings → Environment Variables, add:
//   FETCH_SECRET = any random string you choose (e.g. "fluent-abc-123")
// Then set the same value in fluent-agentic.html: const VERCEL_FETCH_SECRET = 'fluent-abc-123'
//
// Usage: GET /api/fetch?url=https://example.com
// Headers: x-fetch-secret: your-secret
// Returns: { html: "...", status: 200, finalUrl: "..." }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fetch-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Simple secret key check — prevents public misuse of your function
  const secret = process.env.FETCH_SECRET;
  if (secret && req.headers['x-fetch-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let targetUrl;
  try {
    targetUrl = new URL(url);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'Only http/https URLs allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Block private/internal addresses
  const hostname = targetUrl.hostname;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.endsWith('.local')
  ) {
    return res.status(403).json({ error: 'Private addresses not allowed' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FluentAgentic/1.0; +https://fluentagentic.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);
    const html = await response.text();

    return res.status(200).json({
      html,
      status: response.status,
      finalUrl: response.url,
      contentLength: html.length,
    });

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Request timed out' });
    return res.status(502).json({ error: `Fetch failed: ${err.message}` });
  }
}

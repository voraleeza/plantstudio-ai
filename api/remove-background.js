export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const base = process.env.PLANTSTUDIO_INFERENCE_URL;

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      engine: 'Dedicated BiRefNet inference service',
      configured: Boolean(base),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  if (!base) {
    return res.status(503).json({
      error: 'Dedicated inference service is not connected yet. Set PLANTSTUDIO_INFERENCE_URL in Vercel.',
    });
  }

  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const base64 = image.includes(',') ? image.split(',').pop() : image;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Empty image' });
    }

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'plantstudio-upload.jpg');

    const target = `${base.replace(/\/$/, '')}/remove-background`;
    const upstream = await fetch(target, { method: 'POST', body: form });

    if (!upstream.ok) {
      let detail = '';
      try {
        const data = await upstream.json();
        detail = data?.detail || data?.error || '';
      } catch {
        try { detail = await upstream.text(); } catch {}
      }
      return res.status(502).json({
        error: detail ? `Inference service failed: ${detail}` : `Inference service returned ${upstream.status}`,
      });
    }

    const png = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(png);
  } catch (error) {
    console.error('Dedicated inference proxy failed:', error);
    return res.status(502).json({ error: error?.message || 'Inference service connection failed' });
  }
}

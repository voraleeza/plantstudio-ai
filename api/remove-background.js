export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const apiKey = process.env.PHOTOROOM_API_KEY;

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, keyConfigured: Boolean(apiKey) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'PHOTOROOM_API_KEY is not configured in Vercel environment variables.' });
  }

  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 4 * 1024 * 1024) {
        return res.status(413).json({ error: 'Temporary PhotoRoom upload is too large. Please retry with a smaller image.' });
      }
      chunks.push(chunk);
    }

    const imageBuffer = Buffer.concat(chunks);
    if (!imageBuffer.length) {
      return res.status(400).json({ error: 'No image received.' });
    }

    const inputType = req.headers['content-type'] || 'image/jpeg';
    const encodedName = req.headers['x-file-name'] || 'plant-photo.jpg';
    let fileName = 'plant-photo.jpg';
    try { fileName = decodeURIComponent(encodedName); } catch { fileName = encodedName; }

    const formData = new FormData();
    formData.append('image_file', new Blob([imageBuffer], { type: inputType }), fileName);
    formData.append('format', 'png');
    formData.append('channels', 'rgba');
    formData.append('size', 'hd');
    formData.append('crop', 'false');

    const photoRoomResponse = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, Accept: 'image/png, application/json' },
      body: formData,
    });

    if (!photoRoomResponse.ok) {
      const contentType = photoRoomResponse.headers.get('content-type') || '';
      let detail = '';
      if (contentType.includes('application/json')) {
        try {
          const json = await photoRoomResponse.json();
          detail = json?.message || json?.error || JSON.stringify(json).slice(0, 500);
        } catch {}
      } else {
        try { detail = (await photoRoomResponse.text()).slice(0, 500); } catch {}
      }
      const friendly = photoRoomResponse.status === 402
        ? 'PhotoRoom API quota/payment is required.'
        : photoRoomResponse.status === 403
        ? 'PhotoRoom rejected the API key or API access.'
        : `PhotoRoom returned ${photoRoomResponse.status}.`;
      return res.status(photoRoomResponse.status).json({ error: detail ? `${friendly} ${detail}` : friendly });
    }

    const result = Buffer.from(await photoRoomResponse.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(result);
  } catch (error) {
    console.error('PhotoRoom function error:', error);
    return res.status(500).json({ error: 'Background removal failed on the server. Please try again.' });
  }
}

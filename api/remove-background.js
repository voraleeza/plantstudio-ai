import { pipeline, RawImage, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const config = { maxDuration: 300 };

env.allowLocalModels = false;
env.useBrowserCache = false;
env.cacheDir = path.join(os.tmpdir(), 'hf-cache');

let segmenterPromise;
async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = pipeline('background-removal', 'onnx-community/BEN2-ONNX', {
      dtype: 'fp16'
    }).catch((err) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

async function removeRawImage(input) {
  const segmenter = await getSegmenter();
  const output = await segmenter(input);
  const result = Array.isArray(output) ? output[0] : output;
  if (!result) throw new Error('No image returned by remover');
  return result;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query?.test !== '1') {
      return res.status(200).json({ ok: true, engine: 'BEN2 server', ready: true });
    }
    try {
      const sample = await RawImage.fromURL('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/woman-with-afro_medium.jpg');
      const result = await removeRawImage(sample);
      const outPath = path.join(os.tmpdir(), `plantstudio-selftest-${Date.now()}.png`);
      await result.save(outPath);
      const png = await fs.readFile(outPath);
      await fs.unlink(outPath).catch(() => {});
      return res.status(200).json({ ok: true, engine: 'BEN2 server', inference: true, pngBytes: png.length, width: result.width, height: result.height });
    } catch (error) {
      console.error('BEN2 self-test failed:', error);
      return res.status(500).json({ ok: false, error: error?.message || 'Self-test failed' });
    }
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { image, mimeType = 'image/jpeg' } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const base64 = image.includes(',') ? image.split(',').pop() : image;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty image' });

    const input = await RawImage.fromBlob(new Blob([buffer], { type: mimeType }));
    const result = await removeRawImage(input);

    const outPath = path.join(os.tmpdir(), `plantstudio-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await result.save(outPath);
    const png = await fs.readFile(outPath);
    await fs.unlink(outPath).catch(() => {});

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(png);
  } catch (error) {
    console.error('BEN2 server remover failed:', error);
    return res.status(500).json({ error: error?.message || 'Background removal failed' });
  }
}

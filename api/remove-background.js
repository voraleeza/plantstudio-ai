import * as ort from 'onnxruntime-node';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const config = { maxDuration: 300 };

const MODEL_URL = 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/main/onnx/model_fp16.onnx';
const MODEL_PATH = path.join(os.tmpdir(), 'birefnet-lite-512-fp16.onnx');
const S = 512;
let sessionPromise = null;

async function ensureModelFile() {
  try {
    const st = await fs.stat(MODEL_PATH);
    if (st.size > 90_000_000) return MODEL_PATH;
  } catch {}
  const r = await fetch(MODEL_URL);
  if (!r.ok) throw new Error(`Model download failed (${r.status})`);
  const ab = await r.arrayBuffer();
  await fs.writeFile(MODEL_PATH, Buffer.from(ab));
  return MODEL_PATH;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const p = await ensureModelFile();
      return ort.InferenceSession.create(p, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: 1,
        interOpNumThreads: 1
      });
    })().catch((e) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise;
}

function resizeToSquareRGBA(src, sw, sh, size) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(sh - 1, Math.max(0, Math.round((y + 0.5) * sh / size - 0.5)));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(sw - 1, Math.max(0, Math.round((x + 0.5) * sw / size - 0.5)));
      const si = (sy * sw + sx) * 4;
      const di = (y * size + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

function makeInput(rgba) {
  const n = S * S;
  const data = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    data[i] = (rgba[p] / 255 - mean[0]) / std[0];
    data[n + i] = (rgba[p + 1] / 255 - mean[1]) / std[1];
    data[2 * n + i] = (rgba[p + 2] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', data, [1, 3, S, S]);
}

function sigmoid(v) { return 1 / (1 + Math.exp(-v)); }

function maskValue(mask, mw, mh, x, y, ow, oh) {
  const fx = Math.max(0, Math.min(mw - 1, (x + 0.5) * mw / ow - 0.5));
  const fy = Math.max(0, Math.min(mh - 1, (y + 0.5) * mh / oh - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const a = mask[y0 * mw + x0] * (1 - dx) + mask[y0 * mw + x1] * dx;
  const b = mask[y1 * mw + x0] * (1 - dx) + mask[y1 * mw + x1] * dx;
  return a * (1 - dy) + b * dy;
}

async function removeBackground(buffer) {
  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  if (!decoded?.data?.length) throw new Error('Could not decode JPEG upload');

  const inputRGBA = resizeToSquareRGBA(decoded.data, decoded.width, decoded.height, S);
  const tensor = makeInput(inputRGBA);
  const session = await getSession();
  const feeds = { [session.inputNames[0]]: tensor };
  const outputs = await session.run(feeds);
  const out = outputs[session.outputNames[0]];
  if (!out?.data?.length) throw new Error('No segmentation mask returned');

  const dims = out.dims || [1, 1, S, S];
  const mh = dims[dims.length - 2] || S;
  const mw = dims[dims.length - 1] || S;
  const raw = out.data;
  const count = mw * mh;
  const offset = Math.max(0, raw.length - count);
  const mask = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const v = Number(raw[offset + i]);
    mask[i] = Math.max(0, Math.min(1, sigmoid(v)));
  }

  const png = new PNG({ width: decoded.width, height: decoded.height });
  for (let y = 0; y < decoded.height; y++) {
    for (let x = 0; x < decoded.width; x++) {
      const i = (y * decoded.width + x) * 4;
      png.data[i] = decoded.data[i];
      png.data[i + 1] = decoded.data[i + 1];
      png.data[i + 2] = decoded.data[i + 2];
      const a = maskValue(mask, mw, mh, x, y, decoded.width, decoded.height);
      png.data[i + 3] = Math.round(a * 255);
    }
  }
  return PNG.sync.write(png);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, engine: 'BiRefNet Lite 512 native CPU server', ready: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') return res.status(400).json({ error: 'Missing image data' });
    const base64 = image.includes(',') ? image.split(',').pop() : image;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Empty image' });

    const png = await removeBackground(buffer);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(png);
  } catch (error) {
    console.error('BiRefNet Lite server remover failed:', error);
    return res.status(500).json({ error: error?.message || 'Background removal failed' });
  }
}

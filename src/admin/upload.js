import { uploadFile } from './api.js';

// Pure helpers (unit-tested) — never upscale past the source width.
export function aspectRatio(w, h) { return (w / h).toFixed(4); }
export function scaledWidth(srcWidth, max) { return Math.round(srcWidth * Math.min(1, max / srcWidth)); }

async function resizeTo(bitmap, w, quality) {
  const h = Math.round(bitmap.height * (w / bitmap.width));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

export async function uploadPhoto(file, onProgress) {
  const id = crypto.randomUUID();
  const bmp = await createImageBitmap(file);
  const ar = aspectRatio(bmp.width, bmp.height);

  onProgress && onProgress('Resizing…');
  const thumbW = scaledWidth(bmp.width, 800);
  const fullW  = scaledWidth(bmp.width, 1920);
  const [thumb, full] = await Promise.all([
    resizeTo(bmp, thumbW, 0.82),
    resizeTo(bmp, fullW, 0.88)
  ]);
  bmp.close();

  onProgress && onProgress('Uploading thumbnail…');
  const { publicUrl: thumbUrl } = await uploadFile(thumb, 'photos/thumb/' + id + '.webp');

  onProgress && onProgress('Uploading full…');
  const { publicUrl: fullUrl } = await uploadFile(full, 'photos/full/' + id + '.webp');

  return { id, thumbUrl, fullUrl, aspectRatio: ar };
}

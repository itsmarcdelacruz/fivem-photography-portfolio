import { uploadFile } from './api.js';

// Pure helpers (unit-tested) — never upscale past the source width.
export function aspectRatio(w, h) {
  return (w / h).toFixed(4);
}
export function scaledWidth(srcWidth, max) {
  return Math.round(srcWidth * Math.min(1, max / srcWidth));
}

export async function hashFile(file) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function resizeTo(bitmap, w, quality) {
  const h = Math.round(bitmap.height * (w / bitmap.width));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

export async function uploadPhoto(file, onProgress) {
  const id = crypto.randomUUID();
  const contentHash = await hashFile(file);
  const bmp = await createImageBitmap(file);
  const ar = aspectRatio(bmp.width, bmp.height);

  onProgress && onProgress('Resizing…');
  const thumbW = scaledWidth(bmp.width, 800);
  const fullW = scaledWidth(bmp.width, 1920);
  const [thumb, full] = await Promise.all([
    resizeTo(bmp, thumbW, 0.82),
    resizeTo(bmp, fullW, 0.88)
  ]);
  bmp.close();

  onProgress && onProgress('Uploading thumbnail…');
  const thumbKey = 'photos/thumb/' + id + '.webp';
  const { publicUrl: thumbUrl } = await uploadFile(thumb, thumbKey);

  onProgress && onProgress('Uploading full…');
  const fullKey = 'photos/full/' + id + '.webp';
  const { publicUrl: fullUrl } = await uploadFile(full, fullKey);

  return {
    id,
    thumbUrl,
    fullUrl,
    aspectRatio: ar,
    contentHash,
    uploadKeys: [thumbKey, fullKey]
  };
}

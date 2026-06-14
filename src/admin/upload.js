import { uploadFile } from './api.js';

async function resizeTo(bitmap, w, quality) {
  const h = Math.round(bitmap.height * (w / bitmap.width));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

export async function uploadPhoto(file, onProgress) {
  const id = crypto.randomUUID();
  const bmp = await createImageBitmap(file);
  const ar = (bmp.width / bmp.height).toFixed(4);

  onProgress && onProgress('Resizing…');
  const thumbW = Math.round(bmp.width * Math.min(1, 800 / bmp.width));
  const fullW  = Math.round(bmp.width * Math.min(1, 1920 / bmp.width));
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

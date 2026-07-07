import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadFile } from './api.js';
import { aspectRatio, hashFile, scaledWidth, uploadPhoto } from './upload.js';

vi.mock('./api.js', () => ({ uploadFile: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('aspectRatio', () => {
  it('formats the ratio to 4 decimals', () => {
    expect(aspectRatio(1600, 1200)).toBe('1.3333');
    expect(aspectRatio(1000, 1000)).toBe('1.0000');
  });
});

describe('scaledWidth', () => {
  it('scales down to the max width', () => {
    expect(scaledWidth(4000, 800)).toBe(800);
    expect(scaledWidth(4000, 1920)).toBe(1920);
  });

  it('never upscales past the source width', () => {
    expect(scaledWidth(600, 800)).toBe(600);
    expect(scaledWidth(1000, 1920)).toBe(1000);
  });
});

describe('hashFile', () => {
  it('returns a stable lowercase SHA-256 hash', async () => {
    expect(await hashFile(new Blob(['same']))).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashFile(new Blob(['same']))).toBe(await hashFile(new Blob(['same'])));
  });
});

describe('uploadPhoto', () => {
  it('uploads and returns the exact thumb and full keys with the content hash', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('photo-id');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 2400,
        height: 1600,
        close: vi.fn()
      })
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { drawImage: vi.fn() };
        }

        async convertToBlob() {
          return new Blob(['resized'], { type: 'image/webp' });
        }
      }
    );
    uploadFile.mockImplementation(async (_blob, key) => ({ publicUrl: `https://cdn/${key}` }));
    const file = new Blob(['original']);

    const result = await uploadPhoto(file);

    expect(uploadFile).toHaveBeenNthCalledWith(1, expect.any(Blob), 'photos/thumb/photo-id.webp');
    expect(uploadFile).toHaveBeenNthCalledWith(2, expect.any(Blob), 'photos/full/photo-id.webp');
    expect(result).toEqual({
      id: 'photo-id',
      thumbUrl: 'https://cdn/photos/thumb/photo-id.webp',
      fullUrl: 'https://cdn/photos/full/photo-id.webp',
      aspectRatio: '1.5000',
      contentHash: await hashFile(file),
      uploadKeys: ['photos/thumb/photo-id.webp', 'photos/full/photo-id.webp']
    });
  });
});

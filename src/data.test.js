import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('public data', () => {
  it('returns the static fallback when no worker URL is configured', async () => {
    vi.stubEnv('VITE_WORKER_URL', '');
    vi.resetModules();
    const { loadPortfolio, SHOTS, CATS } = await import('./data.js');
    const out = await loadPortfolio();
    expect(out.shots).toBe(SHOTS);
    expect(out.cats).toBe(CATS);
    expect(out.collections).toEqual([]);
    expect(out.source).toBe('local');
  });

  it('maps API photos into the gallery shot shape', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => ({
        ok: true,
        json: async () => ({
          ...(url.endsWith('/api/photos') ? { photos: [
            {
              id: '1',
              category: 'city',
              title: 'Skyline',
              meta: 'f/8',
              aspect_ratio: '4/5',
              thumb_url: 'https://r2/thumb.webp',
              full_url: 'https://r2/full.webp',
              alt_text: 'Los Santos skyline',
              collection_ids: ['night-drive']
            }
          ] } : { collections: [{ slug: 'night-drive' }] })
        })
      }))
    );
    vi.resetModules();
    const { loadPortfolio } = await import('./data.js');
    const out = await loadPortfolio();
    expect(out.shots[0]).toEqual({
      id: '1',
      cat: 'city',
      t: 'Skyline',
      m: 'f/8',
      ar: '4/5',
      thumb: 'https://r2/thumb.webp',
      full: 'https://r2/full.webp',
      alt: 'Los Santos skyline',
      collection_ids: ['night-drive']
    });
    expect(out.collections).toEqual([{ slug: 'night-drive' }]);
    expect(out.source).toBe('remote');
  });

  it('throws in production instead of silently showing demo content', async () => {
    const { loadPortfolio } = await import('./data.js');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(loadPortfolio({ workerUrl: 'https://api.example' })).rejects.toThrow('offline');
  });

  it('loads one story by encoded slug', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ collection: { slug: 'neon rain', photos: [] } })
    }));
    const { loadStory } = await import('./data.js');
    expect((await loadStory('neon rain', { workerUrl: 'https://api.example' })).slug).toBe('neon rain');
    expect(fetch).toHaveBeenCalledWith('https://api.example/api/collections/neon%20rain');
  });
});

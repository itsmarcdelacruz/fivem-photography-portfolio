import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('loadData', () => {
  it('returns the static fallback when no worker URL is configured', async () => {
    vi.stubEnv('VITE_WORKER_URL', '');
    vi.resetModules();
    const { loadData, SHOTS, CATS } = await import('./data.js');
    const out = await loadData();
    expect(out.shots).toBe(SHOTS);
    expect(out.cats).toBe(CATS);
  });

  it('maps API photos into the gallery shot shape', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({
          photos: [
            {
              id: '1',
              category: 'city',
              title: 'Skyline',
              meta: 'f/8',
              aspect_ratio: '4/5',
              thumb_url: 'https://r2/thumb.webp',
              full_url: 'https://r2/full.webp'
            }
          ]
        })
      }))
    );
    vi.resetModules();
    const { loadData } = await import('./data.js');
    const out = await loadData();
    expect(out.shots[0]).toEqual({
      id: '1',
      cat: 'city',
      t: 'Skyline',
      m: 'f/8',
      ar: '4/5',
      thumb: 'https://r2/thumb.webp',
      full: 'https://r2/full.webp'
    });
  });

  it('falls back to static shots when the fetch fails', async () => {
    vi.stubEnv('VITE_WORKER_URL', 'https://worker.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    vi.resetModules();
    const { loadData, SHOTS } = await import('./data.js');
    const out = await loadData();
    expect(out.shots).toBe(SHOTS);
  });
});

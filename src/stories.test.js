// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderStoryPage, routeFromPath } from './stories.js';

describe('story routes', () => {
  it('parses home and story routes', () => {
    expect(routeFromPath('/')).toEqual({ name: 'home' });
    expect(routeFromPath('/stories/neon-rain')).toEqual({ name: 'story', slug: 'neon-rain' });
    expect(routeFromPath('/stories/neon%20rain/')).toEqual({ name: 'story', slug: 'neon rain' });
  });

  it('keeps malformed percent escapes routable for the unavailable-story state', () => {
    expect(routeFromPath('/stories/100%')).toEqual({ name: 'story', slug: '100%' });
  });

  it('renders ordered story frames and captions', () => {
    const root = document.createElement('section');
    renderStoryPage(root, {
      title: 'Neon Rain',
      introduction: 'After midnight.',
      event_date: '2026-07-03',
      location: 'Mirror Park',
      photos: [
        { id: 'first', title: 'First', full_url: '/first.webp', alt_text: 'A wet alley', caption: 'Opening frame' },
        { id: 'second', title: 'Second', full_url: '/second.webp', alt_text: '', caption: 'Closing frame' }
      ]
    });
    expect(root.querySelector('h1').textContent).toBe('Neon Rain');
    expect(root.querySelector('.story-header p').textContent).toBe('After midnight.');
    expect(root.querySelector('.story-details').textContent).toBe('2026-07-03 · Mirror Park');
    expect([...root.querySelectorAll('figure')].map((figure) => figure.dataset.photoId)).toEqual(['first', 'second']);
    expect(root.querySelector('img').alt).toBe('A wet alley');
    expect(root.querySelector('figcaption').textContent).toContain('Opening frame');
  });

  it('falls back to photo titles for missing alt text and captions', () => {
    const root = document.createElement('section');
    renderStoryPage(root, {
      title: 'Neon Rain',
      photos: [{ title: 'Last Light', full_url: '/last-light.webp' }]
    });
    expect(root.querySelector('img').alt).toBe('Last Light');
    expect(root.querySelector('figcaption').textContent).toBe('Last Light');
  });
});

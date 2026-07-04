// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderStoryPage, routeFromPath } from './stories.js';

describe('story routes', () => {
  it('parses home and story routes', () => {
    expect(routeFromPath('/')).toEqual({ name: 'home' });
    expect(routeFromPath('/stories/neon-rain')).toEqual({ name: 'story', slug: 'neon-rain' });
    expect(routeFromPath('/stories/neon%20rain/')).toEqual({ name: 'story', slug: 'neon rain' });
  });

  it('renders ordered story frames and captions', () => {
    const root = document.createElement('section');
    renderStoryPage(root, {
      title: 'Neon Rain',
      introduction: 'After midnight.',
      photos: [
        { id: 'first', title: 'First', full_url: '/first.webp', alt_text: 'A wet alley', caption: 'Opening frame' },
        { id: 'second', title: 'Second', full_url: '/second.webp', alt_text: '', caption: 'Closing frame' }
      ]
    });
    expect(root.querySelector('h1').textContent).toBe('Neon Rain');
    expect([...root.querySelectorAll('figure')].map((figure) => figure.dataset.photoId)).toEqual(['first', 'second']);
    expect(root.querySelector('img').alt).toBe('A wet alley');
    expect(root.querySelector('figcaption').textContent).toContain('Opening frame');
  });
});

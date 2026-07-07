// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  createGalleryFilterController,
  filterShots,
  getAdjacentVisibleShot,
  renderPortfolioError,
  renderStoryHighlights,
  renderStoryPage,
  routeFromPath
} from './stories.js';

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
        {
          id: 'first',
          title: 'First',
          full_url: '/first.webp',
          alt_text: 'A wet alley',
          caption: 'Opening frame'
        },
        {
          id: 'second',
          title: 'Second',
          full_url: '/second.webp',
          alt_text: '',
          caption: 'Closing frame'
        }
      ]
    });
    expect(root.querySelector('h1').textContent).toBe('Neon Rain');
    expect(root.querySelector('.story-header p').textContent).toBe('After midnight.');
    expect(root.querySelector('.story-details').textContent).toBe('2026-07-03 · Mirror Park');
    expect([...root.querySelectorAll('figure')].map((figure) => figure.dataset.photoId)).toEqual([
      'first',
      'second'
    ]);
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

describe('homepage story browsing', () => {
  it('uses the first collection as Latest Dispatch', () => {
    const root = document.createElement('div');
    renderStoryHighlights(root, [
      {
        slug: 'first',
        title: 'First',
        introduction: 'Lead',
        cover_thumb_url: '/one.webp',
        frame_count: 8
      },
      { slug: 'second', title: 'Second', cover_thumb_url: '/two.webp', frame_count: 4 }
    ]);
    expect(root.querySelector('[data-featured-story]').getAttribute('href')).toBe('/stories/first');
    expect(root.querySelectorAll('[data-story-card]')).toHaveLength(2);
  });

  it('combines category and collection filters', () => {
    const shots = [
      { cat: 'crew', collection_ids: ['a'] },
      { cat: 'crew', collection_ids: ['b'] },
      { cat: 'vehicles', collection_ids: ['a'] }
    ];
    expect(filterShots(shots, { category: 'crew', collectionId: 'a' })).toEqual([shots[0]]);
  });

  function galleryFixture() {
    const gallery = document.createElement('section');
    gallery.innerHTML = `
      <div>
        <button data-filter-kind="category" data-filter-value="all" class="active"></button>
        <button data-filter-kind="category" data-filter-value="crew"></button>
      </div>
      <div>
        <button data-filter-kind="collectionId" data-filter-value="all" class="active"></button>
        <button data-filter-kind="collectionId" data-filter-value="a"></button>
      </div>
      <p id="galleryResults"></p>
      <button id="filterReset"></button>
      <p id="galleryEmpty" hidden></p>
      <figure class="shot" data-idx="0" data-filled></figure>
      <figure class="shot" data-idx="1" data-filled></figure>
      <figure class="shot" data-idx="2" data-filled></figure>`;
    return gallery;
  }

  it('updates exact counts, combines filters, and exposes no matches', () => {
    const gallery = galleryFixture();
    const shots = [
      { cat: 'crew', collection_ids: ['a'] },
      { cat: 'crew', collection_ids: ['b'] },
      { cat: 'vehicles', collection_ids: ['a'] }
    ];
    createGalleryFilterController(gallery, shots);
    expect(gallery.querySelector('#galleryResults').textContent).toBe('3 of 3 frames');

    gallery.querySelector('[data-filter-value="crew"]').click();
    gallery.querySelector('[data-filter-value="a"]').click();
    expect(gallery.querySelector('#galleryResults').textContent).toBe('1 of 3 frames');
    expect(gallery.querySelectorAll('.shot.hide')).toHaveLength(2);

    const category = gallery.querySelector('[data-filter-value="crew"]');
    category.dataset.filterValue = 'nightlife';
    category.click();
    expect(gallery.querySelector('#galleryEmpty').hidden).toBe(false);
  });

  it('resets both filters and maintains aria-pressed selected state', () => {
    const gallery = galleryFixture();
    const shots = [
      { cat: 'crew', collection_ids: ['a'] },
      { cat: 'vehicles', collection_ids: ['a'] }
    ];
    createGalleryFilterController(gallery, shots);
    const crew = gallery.querySelector('[data-filter-value="crew"]');
    const story = gallery.querySelector('[data-filter-value="a"]');
    crew.click();
    story.click();
    expect(crew.getAttribute('aria-pressed')).toBe('true');
    expect(story.getAttribute('aria-pressed')).toBe('true');

    gallery.querySelector('#filterReset').click();
    expect(gallery.querySelector('#galleryResults').textContent).toBe('2 of 2 frames');
    expect(
      [...gallery.querySelectorAll('[data-filter-value="all"]')].every(
        (button) => button.getAttribute('aria-pressed') === 'true'
      )
    ).toBe(true);
    expect(crew.getAttribute('aria-pressed')).toBe('false');
    expect(story.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders production load errors with a working retry', () => {
    const grid = document.createElement('div');
    let retries = 0;
    renderPortfolioError(grid, () => {
      retries += 1;
    });
    expect(grid.textContent).toContain('The portfolio could not be loaded.');
    grid.querySelector('button').click();
    expect(retries).toBe(1);
  });

  it('lightbox sequencing skips filtered and unfilled shots in both directions', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <figure class="shot" data-idx="0" data-filled></figure>
      <figure class="shot hide" data-idx="1" data-filled></figure>
      <figure class="shot" data-idx="2"></figure>
      <figure class="shot" data-idx="3" data-filled></figure>`;
    const first = root.querySelector('[data-idx="0"]');
    const last = root.querySelector('[data-idx="3"]');
    expect(getAdjacentVisibleShot(root, first, 1)).toBe(last);
    expect(getAdjacentVisibleShot(root, first, -1)).toBe(last);
    expect(getAdjacentVisibleShot(root, last, 1)).toBe(first);
  });
});

export function routeFromPath(pathname) {
  const match = String(pathname).match(/^\/stories\/([^/]+)\/?$/);
  if (!match) return { name: 'home' };
  try {
    return { name: 'story', slug: decodeURIComponent(match[1]) };
  } catch {
    return { name: 'story', slug: match[1] };
  }
}

export function filterShots(shots, { category = 'all', collectionId = 'all' } = {}) {
  return shots.filter(shot =>
    (category === 'all' || shot.cat === category) &&
    (collectionId === 'all' || (shot.collection_ids || []).includes(collectionId))
  );
}

function syncFilterButtons(root, state) {
  root.querySelectorAll('[data-filter-kind]').forEach(button => {
    const active = state[button.dataset.filterKind] === button.dataset.filterValue;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

export function createGalleryFilterController(root, shots, { loadError = false } = {}) {
  let state = { category: 'all', collectionId: 'all' };
  const results = root.querySelector('#galleryResults');
  const empty = root.querySelector('#galleryEmpty');

  function apply() {
    const visible = new Set(filterShots(shots, state));
    root.querySelectorAll('.shot').forEach(figure => {
      figure.classList.toggle('hide', !visible.has(shots[Number(figure.dataset.idx)]));
    });
    results.textContent = `${visible.size} of ${shots.length} frames`;
    empty.hidden = visible.size !== 0 || loadError;
    syncFilterButtons(root, state);
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-filter-kind]');
    if (!button || !root.contains(button)) return;
    state = { ...state, [button.dataset.filterKind]: button.dataset.filterValue };
    apply();
  });
  root.querySelector('#filterReset').addEventListener('click', () => {
    state = { category: 'all', collectionId: 'all' };
    apply();
  });
  apply();
  return { apply };
}

export function renderPortfolioError(root, retry) {
  root.innerHTML =
    '<div class="portfolio-error"><p>The portfolio could not be loaded.</p>' +
    '<button type="button">Try again</button></div>';
  root.querySelector('button').addEventListener('click', retry);
}

export function getVisibleFilledShots(root) {
  return Array.from(root.querySelectorAll('.shot')).filter(
    figure => !figure.classList.contains('hide') && figure.hasAttribute('data-filled')
  );
}

export function getAdjacentVisibleShot(root, current, direction) {
  const visible = getVisibleFilledShots(root);
  if (!visible.length) return null;
  const index = visible.indexOf(current);
  return visible[(index + direction + visible.length) % visible.length];
}

export function renderStoryHighlights(root, collections) {
  root.textContent = '';
  if (!collections.length) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  const featured = collections[0];
  const feature = document.createElement('a');
  feature.className = 'featured-dispatch';
  feature.dataset.featuredStory = '';
  feature.href = '/stories/' + encodeURIComponent(featured.slug);
  const image = document.createElement('img');
  image.src = featured.cover_thumb_url || '';
  image.alt = '';
  const copy = document.createElement('div');
  const label = document.createElement('span');
  label.className = 'eyebrow';
  label.textContent = 'Latest Dispatch';
  const title = document.createElement('h2');
  title.textContent = featured.title;
  const intro = document.createElement('p');
  intro.textContent = featured.introduction || `${featured.frame_count} frames`;
  copy.append(label, title, intro);
  feature.append(image, copy);

  const grid = document.createElement('div');
  grid.className = 'story-card-grid';
  for (const collection of collections) {
    const card = document.createElement('a');
    card.dataset.storyCard = '';
    card.className = 'story-card';
    card.href = '/stories/' + encodeURIComponent(collection.slug);
    card.innerHTML = '<img alt=""><div><h3></h3><span></span></div>';
    card.querySelector('img').src = collection.cover_thumb_url || '';
    card.querySelector('h3').textContent = collection.title;
    card.querySelector('span').textContent = `${collection.frame_count} frames`;
    grid.appendChild(card);
  }
  root.append(feature, grid);
}

export function renderStoryPage(root, collection) {
  root.textContent = '';
  const header = document.createElement('header');
  header.className = 'story-header';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Photo story';
  const title = document.createElement('h1');
  title.textContent = collection.title;
  const intro = document.createElement('p');
  intro.textContent = collection.introduction || '';
  const details = document.createElement('p');
  details.className = 'story-details';
  details.textContent = [collection.event_date, collection.location].filter(Boolean).join(' · ');
  header.append(eyebrow, title, intro);
  if (details.textContent) header.appendChild(details);

  const sequence = document.createElement('div');
  sequence.className = 'story-sequence';
  for (const photo of collection.photos || []) {
    const figure = document.createElement('figure');
    figure.className = 'story-frame';
    figure.dataset.photoId = photo.id || '';
    figure.tabIndex = 0;
    figure.setAttribute('role', 'button');
    figure.setAttribute('aria-label', `View ${photo.title || 'photo'} full screen`);
    const image = document.createElement('img');
    image.src = photo.full_url;
    image.alt = photo.alt_text || photo.title || '';
    image.loading = 'lazy';
    const caption = document.createElement('figcaption');
    caption.textContent = photo.caption || photo.title || '';
    figure.append(image, caption);
    sequence.appendChild(figure);
  }
  root.append(header, sequence);

  const lightboxRoot = document.getElementById('lightbox');
  if (lightboxRoot) {
    const storyLightboxItems = () => (collection.photos || []).map(photo => ({
      src: photo.full_url,
      thumb: photo.thumb_url,
      title: photo.title,
      alt: photo.alt_text || photo.title,
      caption: photo.caption,
      meta: photo.meta,
      collection: collection.title
    }));
    const lightbox = createLightbox(lightboxRoot, { getItems: storyLightboxItems });
    const openFrame = figure => {
      const frames = [...sequence.querySelectorAll('.story-frame')];
      lightbox.open(frames.indexOf(figure), figure);
    };
    sequence.addEventListener('click', event => {
      const figure = event.target.closest('.story-frame');
      if (figure) openFrame(figure);
    });
    sequence.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const figure = event.target.closest('.story-frame');
      if (!figure) return;
      event.preventDefault();
      openFrame(figure);
    });
  }
}
import { createLightbox } from './lightbox.js';

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
}

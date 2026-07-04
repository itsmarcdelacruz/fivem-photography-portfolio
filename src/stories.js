export function routeFromPath(pathname) {
  const match = String(pathname).match(/^\/stories\/([^/]+)\/?$/);
  return match
    ? { name: 'story', slug: decodeURIComponent(match[1]) }
    : { name: 'home' };
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

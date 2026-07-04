import './styles.css';
import './image-slot.js';
import { loadStory } from './data.js';
import { renderStoryPage, routeFromPath } from './stories.js';

const route = routeFromPath(location.pathname);
if (route.name === 'story') {
  document.querySelector('.hero').hidden = true;
  document.getElementById('homeContent').hidden = true;
  const root = document.getElementById('storyContent');
  root.hidden = false;
  try {
    renderStoryPage(root, await loadStory(route.slug));
  } catch {
    root.innerHTML = '<section class="story-error"><h1>Story unavailable</h1><p>Try again or return to all stories.</p><a href="/">Return home</a></section>';
  }
} else {
  await import('./app.js');
}

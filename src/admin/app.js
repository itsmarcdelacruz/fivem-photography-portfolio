import { initOverview } from './views/overview.js';
import { initPhotos }   from './views/photos.js';
import { initInbox }    from './views/inbox.js';
import { initSettings } from './views/settings.js';

const VIEWS = { overview: initOverview, photos: initPhotos, inbox: initInbox, settings: initSettings };

export function bootAdmin(root) {
  // Static shell structure — not user input // nosec
  root.innerHTML =
    '<div class="admin-layout">' +
      '<nav class="admin-nav">' +
        '<div class="admin-brand"><span class="mono-k">KM</span> Admin</div>' +
        '<ul>' +
          '<li><a href="#overview" data-view="overview">Overview</a></li>' +
          '<li><a href="#photos"   data-view="photos">Photos</a></li>' +
          '<li><a href="#inbox"    data-view="inbox">Inbox</a></li>' +
          '<li><a href="#settings" data-view="settings">Settings</a></li>' +
        '</ul>' +
        '<button id="signOutBtn" class="sign-out-btn">Sign out</button>' +
      '</nav>' +
      '<main class="admin-main" id="adminMain"></main>' +
    '</div>';

  document.getElementById('signOutBtn').addEventListener('click', () => { localStorage.removeItem('admin_token'); location.reload(); });
  root.querySelectorAll('[data-view]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.view); }));
  navigate(location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'overview');
}

function navigate(view) {
  location.hash = view;
  document.querySelectorAll('.admin-nav [data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const main = document.getElementById('adminMain');
  main.textContent = 'Loading…';
  (VIEWS[view] || VIEWS.overview)(main);
}

import { initOverview }  from './views/overview.js';
import { initPhotos }    from './views/photos.js';
import { initCollections } from './views/collections.js';
import { initInbox }     from './views/inbox.js';
import { initSchedule }  from './views/schedule.js';
import { initSettings }  from './views/settings.js';
import { confirmAdminNavigation, handleAdminBeforeUnload } from './unsaved-changes.js';

const VIEWS = {
  overview: initOverview,
  photos: initPhotos,
  collections: initCollections,
  inbox: initInbox,
  schedule: initSchedule,
  settings: initSettings
};

let activeHashHandler;

export function bootAdmin(root, { reload = () => location.reload() } = {}) {
  // Static shell structure — not user input // nosec
  root.innerHTML =
    '<div class="admin-layout">' +
      '<nav class="admin-nav">' +
        '<div class="admin-brand"><span class="mono-k">KM</span> Admin</div>' +
        '<ul>' +
          '<li><a href="#overview" data-view="overview">Overview</a></li>' +
          '<li><a href="#photos"   data-view="photos">Photos</a></li>' +
          '<li><a href="#collections" data-view="collections">Collections</a></li>' +
          '<li><a href="#inbox"    data-view="inbox">Inbox</a></li>' +
          '<li><a href="#schedule" data-view="schedule">Schedule</a></li>' +
          '<li><a href="#settings" data-view="settings">Settings</a></li>' +
        '</ul>' +
        '<button id="signOutBtn" class="sign-out-btn">Sign out</button>' +
      '</nav>' +
      '<main class="admin-main" id="adminMain"></main>' +
    '</div>';

  let currentView = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'overview';
  const renderView = view => {
    currentView = view in VIEWS ? view : 'overview';
    document.querySelectorAll('.admin-nav [data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === currentView));
    const main = document.getElementById('adminMain');
    main.textContent = 'Loading…';
    VIEWS[currentView](main);
  };
  const navigate = view => {
    const target = view in VIEWS ? view : 'overview';
    if (target === currentView) return true;
    if (!confirmAdminNavigation()) return false;
    if (location.hash !== `#${target}`) location.hash = target;
    renderView(target);
    return true;
  };

  document.getElementById('signOutBtn').addEventListener('click', () => {
    if (!confirmAdminNavigation()) return;
    localStorage.removeItem('admin_token');
    reload();
  });
  root.querySelectorAll('[data-view]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    navigate(a.dataset.view);
  }));
  window.onbeforeunload = handleAdminBeforeUnload;
  if (activeHashHandler) window.removeEventListener('hashchange', activeHashHandler);
  activeHashHandler = () => {
    const target = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'overview';
    if (target === currentView) return;
    if (!confirmAdminNavigation()) {
      history.replaceState(null, '', `#${currentView}`);
      return;
    }
    renderView(target);
  };
  window.addEventListener('hashchange', activeHashHandler);
  renderView(currentView);
}

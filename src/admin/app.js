import { initOverview } from './views/overview.js';
import { initPhotos } from './views/photos.js';
import { initCollections } from './views/collections.js';
import { initInbox } from './views/inbox.js';
import { initSchedule } from './views/schedule.js';
import { initSettings } from './views/settings.js';
import { confirmAdminNavigation, handleAdminBeforeUnload } from './unsaved-changes.js';
import { api } from './api.js';

const VIEWS = {
  overview: initOverview,
  photos: initPhotos,
  collections: initCollections,
  inbox: initInbox,
  schedule: initSchedule,
  settings: initSettings
};

let activeHashHandler;
let activeKeyHandler;

const VIEW_LABELS = {
  overview: 'Overview',
  photos: 'Photos',
  collections: 'Collections',
  inbox: 'Inbox',
  schedule: 'Schedule',
  settings: 'Settings'
};

function navItem(view, index) {
  return (
    '<li><a href="#' +
    view +
    '" data-view="' +
    view +
    '"><span class="nav-index">' +
    index +
    '</span><span>' +
    VIEW_LABELS[view] +
    '</span></a></li>'
  );
}

export function bootAdmin(root, { reload = () => location.reload() } = {}) {
  // Static shell structure — not user input // nosec
  root.innerHTML =
    '<div class="admin-layout">' +
    '<header class="admin-mobile-header">' +
    '<a class="mobile-brand" href="#overview" data-view="overview"><span>KMN</span> Studio</a>' +
    '<span class="mobile-view-title" id="mobileViewTitle">Overview</span>' +
    '<button class="admin-menu-btn" id="adminMenuBtn" type="button" aria-expanded="false" aria-controls="adminNav" aria-label="Open navigation"><span></span><span></span></button>' +
    '</header>' +
    '<nav class="admin-nav" id="adminNav" aria-label="Studio administration">' +
    '<a class="admin-brand" href="#overview" data-view="overview">' +
    '<span class="admin-brand-mark">KMN</span>' +
    '<span class="admin-brand-copy"><strong>Katie Monroe</strong><small>Studio administration</small></span>' +
    '</a>' +
    '<p class="nav-section-label">Workspace</p>' +
    '<ul class="admin-nav-list">' +
    navItem('overview', '01') +
    navItem('photos', '02') +
    navItem('collections', '03') +
    navItem('inbox', '04') +
    navItem('schedule', '05') +
    navItem('settings', '06') +
    '</ul>' +
    '<div class="admin-nav-footer">' +
    '<div class="studio-status" id="sidebarAvailability"><span class="studio-status-dot"></span><span><small>Portfolio status</small><strong>Checking…</strong></span></div>' +
    '<a class="portfolio-link" href="/" target="_blank" rel="noopener">View live portfolio <span aria-hidden="true">↗</span></a>' +
    '<button id="signOutBtn" class="sign-out-btn" type="button">Sign out</button>' +
    '</div>' +
    '</nav>' +
    '<button class="admin-nav-scrim" id="adminNavScrim" type="button" aria-label="Close navigation" tabindex="-1"></button>' +
    '<main class="admin-main" id="adminMain"></main>' +
    '</div>';

  let currentView = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'overview';
  const layout = root.querySelector('.admin-layout');
  const menuButton = document.getElementById('adminMenuBtn');
  const setMenuOpen = (open) => {
    layout.classList.toggle('nav-open', open);
    document.body.classList.toggle('admin-menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  const renderView = (view) => {
    currentView = view in VIEWS ? view : 'overview';
    document
      .querySelectorAll('.admin-nav [data-view]')
      .forEach((a) => a.classList.toggle('active', a.dataset.view === currentView));
    document.getElementById('mobileViewTitle').textContent = VIEW_LABELS[currentView];
    const main = document.getElementById('adminMain');
    main.textContent = 'Loading…';
    VIEWS[currentView](main);
    setMenuOpen(false);
  };
  const navigate = (view) => {
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
  root.querySelectorAll('[data-view]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(a.dataset.view);
    })
  );
  menuButton.addEventListener('click', () => {
    setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
  });
  document.getElementById('adminNavScrim').addEventListener('click', () => setMenuOpen(false));
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
  if (activeKeyHandler) document.removeEventListener('keydown', activeKeyHandler);
  activeKeyHandler = (event) => {
    if (event.key === 'Escape' && layout.classList.contains('nav-open')) {
      setMenuOpen(false);
      menuButton.focus();
    }
  };
  document.addEventListener('keydown', activeKeyHandler);

  api.settings
    .get()
    .then((settings) => {
      const status = document.getElementById('sidebarAvailability');
      if (!status) return;
      const open = settings.availability === 'open';
      status.classList.toggle('is-closed', !open);
      status.querySelector('strong').textContent = open
        ? 'Open for commissions'
        : 'Commissions closed';
    })
    .catch(() => {
      const status = document.getElementById('sidebarAvailability');
      if (status) status.querySelector('strong').textContent = 'Status unavailable';
    });
  renderView(currentView);
}

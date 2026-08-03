import { api } from '../api.js';
import { escHtml } from '../utils.js';

const isPublished = (item) => item.is_published === true || Number(item.is_published) === 1;

function validDate(value) {
  if (!value) return null;
  const date = new Date(String(value).length === 10 ? value + 'T12:00:00' : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function deriveOverview(
  { photos = [], collections = [], commissions = [], shoots = [] },
  now = new Date()
) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const upcoming = shoots
    .map((shoot) => ({ shoot, date: validDate(shoot.date) }))
    .filter(({ date }) => date && date >= today)
    .sort((a, b) => a.date - b.date)[0]?.shoot;

  const recentPhotos = [...photos]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 4);

  const activity = [
    ...photos.map((photo) => ({
      type: 'photo',
      label: photo.title || 'Untitled frame',
      date: photo.created_at || ''
    })),
    ...commissions.map((commission) => ({
      type: 'inquiry',
      label: commission.name + ' · ' + (commission.shoot_type || 'Commission request'),
      date: commission.created_at || ''
    })),
    ...shoots.map((shoot) => ({
      type: 'shoot',
      label: shoot.name + ' · ' + (shoot.shoot_type || 'Photo shoot'),
      date: shoot.created_at || shoot.date || ''
    }))
  ]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 5);

  return {
    totalPhotos: photos.length,
    publishedPhotos: photos.filter(isPublished).length,
    newInquiries: commissions.filter((item) => item.status === 'new').length,
    activeShoots: shoots.filter((item) => ['booked', 'shooting'].includes(item.status)).length,
    publishedCollections: collections.filter(isPublished).length,
    pipeline: {
      booked: shoots.filter((item) => item.status === 'booked').length,
      shooting: shoots.filter((item) => item.status === 'shooting').length,
      delivered: shoots.filter((item) => item.status === 'delivered').length
    },
    upcoming,
    recentPhotos,
    activity
  };
}

function resultValue(result, key, fallback) {
  return result.status === 'fulfilled' ? result.value[key] || fallback : fallback;
}

function panelWarning(show) {
  return show
    ? '<p class="overview-warning" role="status">This panel could not refresh. Try again shortly.</p>'
    : '';
}

function metric(value, label, meta, unavailable = false) {
  return (
    '<article class="overview-metric' +
    (unavailable ? ' is-unavailable' : '') +
    '"><span class="metric-label">' +
    escHtml(label) +
    '</span><strong>' +
    (unavailable ? '—' : escHtml(String(value))) +
    '</strong><small>' +
    escHtml(meta) +
    '</small></article>'
  );
}

function formatShootDate(value) {
  const date = validDate(value);
  if (!date) return 'Date to be confirmed';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function formatActivityDate(value) {
  const date = validDate(value);
  if (!date) return 'Recently';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function syncSidebarAvailability(open) {
  const status = document.getElementById('sidebarAvailability');
  if (!status) return;
  status.classList.toggle('is-closed', !open);
  status.querySelector('strong').textContent = open ? 'Open for commissions' : 'Commissions closed';
}

export async function initOverview(c) {
  c.innerHTML =
    '<div class="overview-loading" aria-live="polite">Preparing the studio overview…</div>';
  const [photosResult, collectionsResult, commissionsResult, shootsResult, settingsResult] =
    await Promise.allSettled([
      api.photos.adminList(),
      api.collections.list(),
      api.commissions.list(),
      api.shoots.list(),
      api.settings.get()
    ]);

  const photos = resultValue(photosResult, 'photos', []);
  const collections = resultValue(collectionsResult, 'collections', []);
  const commissions = resultValue(commissionsResult, 'commissions', []);
  const shoots = resultValue(shootsResult, 'shoots', []);
  const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
  const overview = deriveOverview({ photos, collections, commissions, shoots });
  const settingsOpen = settings?.availability === 'open';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  const recentFrames = overview.recentPhotos.length
    ? overview.recentPhotos
        .map(
          (photo) =>
            '<figure class="recent-frame"><img src="' +
            escHtml(photo.thumb_url || photo.full_url || '') +
            '" alt="' +
            escHtml(photo.alt_text || photo.title || 'Portfolio photograph') +
            '" loading="lazy"><figcaption><span>' +
            escHtml(photo.title || 'Untitled frame') +
            '</span><small>' +
            escHtml(photo.category || (isPublished(photo) ? 'Published' : 'Draft')) +
            '</small></figcaption></figure>'
        )
        .join('')
    : '<div class="overview-empty">Your latest frames will appear here after the first upload.</div>';

  const activityItems = overview.activity.length
    ? overview.activity
        .map(
          (item) =>
            '<li><span class="activity-mark activity-mark-' +
            escHtml(item.type) +
            '"></span><span class="activity-copy"><strong>' +
            escHtml(item.label) +
            '</strong><small>' +
            escHtml(item.type) +
            '</small></span><time>' +
            escHtml(formatActivityDate(item.date)) +
            '</time></li>'
        )
        .join('')
    : '<li class="overview-empty">New uploads, inquiries, and shoots will collect here.</li>';

  const upcoming = overview.upcoming
    ? '<div class="upcoming-shoot"><span class="upcoming-date">' +
      escHtml(formatShootDate(overview.upcoming.date)) +
      '</span><h4>' +
      escHtml(overview.upcoming.name) +
      '</h4><p>' +
      escHtml(overview.upcoming.shoot_type || 'Photo shoot') +
      (overview.upcoming.contact ? ' · ' + escHtml(overview.upcoming.contact) : '') +
      '</p><a href="#schedule">Open schedule <span aria-hidden="true">→</span></a></div>'
    : '<div class="overview-empty">No upcoming shoot is dated yet.<a href="#schedule">Plan a shoot →</a></div>';

  // Static template — all API-backed values are escaped above // nosec
  c.innerHTML =
    '<section class="overview-hero">' +
    '<div class="overview-intro"><span class="overview-kicker">Studio pulse · ' +
    escHtml(today) +
    '</span><h2>The studio,<br><em>at a glance.</em></h2><p>Frames, inquiries, and productions—organized for the next move.</p></div>' +
    '<div class="availability-card' +
    (settingsOpen ? '' : ' is-closed') +
    '"><div><span class="availability-eyebrow">Commission availability</span><strong id="availabilityText">' +
    (settings
      ? escHtml(
          settings.availability_label ||
            (settingsOpen ? 'Open for commissions' : 'Currently closed')
        )
      : 'Status unavailable') +
    '</strong></div><label class="availability-switch"><span class="sr-only">Accepting commissions</span><input type="checkbox" id="availCheck"' +
    (settingsOpen ? ' checked' : '') +
    (settings ? '' : ' disabled') +
    '><span class="availability-track"></span></label></div>' +
    '</section>' +
    '<nav class="overview-quick-links" aria-label="Quick actions"><a href="#photos"><span>01</span>Upload frames</a><a href="#inbox"><span>02</span>Review inquiries</a><a href="#schedule"><span>03</span>Plan a shoot</a></nav>' +
    '<section class="overview-metrics" aria-label="Studio statistics">' +
    metric(
      overview.totalPhotos,
      'Total frames',
      overview.publishedPhotos + ' published',
      photosResult.status === 'rejected'
    ) +
    metric(
      overview.newInquiries,
      'New inquiries',
      'Waiting for review',
      commissionsResult.status === 'rejected'
    ) +
    metric(
      overview.activeShoots,
      'Active shoots',
      'Booked or shooting',
      shootsResult.status === 'rejected'
    ) +
    metric(
      overview.publishedCollections,
      'Live stories',
      collections.length + ' collections total',
      collectionsResult.status === 'rejected'
    ) +
    '</section>' +
    '<section class="overview-grid">' +
    '<article class="overview-panel pipeline-panel"><header><div><span class="panel-kicker">Production</span><h3>Studio pipeline</h3></div><a href="#schedule">View board</a></header>' +
    panelWarning(shootsResult.status === 'rejected') +
    '<div class="pipeline-stages"><div><span class="pipeline-dot booked"></span><strong>' +
    overview.pipeline.booked +
    '</strong><small>Booked</small></div><div><span class="pipeline-dot shooting"></span><strong>' +
    overview.pipeline.shooting +
    '</strong><small>Shooting</small></div><div><span class="pipeline-dot delivered"></span><strong>' +
    overview.pipeline.delivered +
    '</strong><small>Delivered</small></div></div></article>' +
    '<article class="overview-panel upcoming-panel"><header><div><span class="panel-kicker">Next up</span><h3>Upcoming shoot</h3></div></header>' +
    panelWarning(shootsResult.status === 'rejected') +
    upcoming +
    '</article>' +
    '<article class="overview-panel recent-panel"><header><div><span class="panel-kicker">The archive</span><h3>Recent frames</h3></div><a href="#photos">Manage photos</a></header>' +
    panelWarning(photosResult.status === 'rejected') +
    '<div class="recent-frame-grid">' +
    recentFrames +
    '</div></article>' +
    '<article class="overview-panel activity-panel"><header><div><span class="panel-kicker">Updates</span><h3>Recent activity</h3></div></header>' +
    panelWarning(
      photosResult.status === 'rejected' ||
        commissionsResult.status === 'rejected' ||
        shootsResult.status === 'rejected'
    ) +
    '<ul class="overview-activity">' +
    activityItems +
    '</ul></article>' +
    '</section>';

  const check = document.getElementById('availCheck');
  if (settings) syncSidebarAvailability(settingsOpen);
  check.addEventListener('change', async function () {
    const isOpen = this.checked;
    const card = this.closest('.availability-card');
    const text = document.getElementById('availabilityText');
    card.classList.toggle('is-closed', !isOpen);
    text.textContent = isOpen ? 'Open for commissions' : 'Commissions are closed';
    syncSidebarAvailability(isOpen);
    try {
      await api.settings.update({ availability: isOpen ? 'open' : 'closed' });
    } catch (err) {
      console.error('Failed to update availability:', err);
      this.checked = !isOpen;
      card.classList.toggle('is-closed', isOpen);
      text.textContent = isOpen ? 'Commissions are closed' : 'Open for commissions';
      syncSidebarAvailability(!isOpen);
    }
  });
}

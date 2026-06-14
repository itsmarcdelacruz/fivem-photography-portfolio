import { api } from '../api.js';
import { escHtml } from '../utils.js';

export async function initOverview(c) {
  c.textContent = 'Loading…';
  const [{ photos }, settings] = await Promise.all([api.photos.list(), api.settings.get()]);
  let commissions = [];
  try { commissions = (await api.commissions.list()).commissions; } catch {}
  const newCount = commissions.filter(x => x.status === 'new').length;

  // Derive last 5 activity items from photos + commissions sorted by created_at
  const activity = [
    ...photos.map(p => ({ type: 'photo', label: p.title, date: p.created_at })),
    ...commissions.map(c2 => ({ type: 'commission', label: c2.name + ' (' + (c2.shoot_type || 'request') + ')', date: c2.created_at }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  // Static template — dynamic values escaped via escHtml // nosec
  c.innerHTML =
    '<h2 class="view-title">Overview</h2>' +
    '<div class="stat-grid">' +
      stat(photos.length, 'Total photos') +
      stat(newCount,      'New commissions') +
      stat(settings.availability === 'open' ? 'Open' : 'Closed', 'Status') +
    '</div>' +
    '<label class="toggle-label"><input type="checkbox" id="availCheck"' +
    (settings.availability === 'open' ? ' checked' : '') + '><span>' +
    escHtml(settings.availability_label) + '</span></label>' +
    '<h3 class="activity-heading">Recent activity</h3>' +
    '<ul class="activity-list">' +
    (activity.length
      ? activity.map(a =>
          '<li class="activity-item">' +
            '<span class="activity-badge activity-' + escHtml(a.type) + '">' + escHtml(a.type) + '</span>' +
            '<span class="activity-label">' + escHtml(a.label) + '</span>' +
            '<span class="activity-date">' + escHtml(String(a.date).slice(0, 10)) + '</span>' +
          '</li>'
        ).join('')
      : '<li class="activity-item" style="color:var(--ink2)">No activity yet.</li>') +
    '</ul>';

  document.getElementById('availCheck').addEventListener('change', function () {
    api.settings.update({ availability: this.checked ? 'open' : 'closed' });
  });
}

function stat(v, label) {
  return '<div class="stat-card"><div class="stat-val">' + escHtml(String(v)) + '</div><div class="stat-lab">' + escHtml(label) + '</div></div>';
}

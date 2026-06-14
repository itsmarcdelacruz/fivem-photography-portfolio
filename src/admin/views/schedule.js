import { api } from '../api.js';
import { escHtml } from '../utils.js';

const SHOOT_TYPES = ['Portrait','Crew','Vehicle','Cityscape','Action','Full set'];
const NEXT_STATUS = { booked: 'shooting', shooting: 'delivered' };
const NEXT_LABEL  = { booked: 'Shooting →', shooting: 'Delivered →' };

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export async function initSchedule(c) {
  c.textContent = 'Loading…';
  let shoots;
  try {
    ({ shoots } = await api.shoots.list());
  } catch (err) {
    c.textContent = 'Failed to load schedule. Check your connection.';
    console.error('initSchedule:', err);
    return;
  }
  renderSchedule(c, shoots);
}

function renderSchedule(c, shoots) {
  const shell =
    '<h2 class="view-title">Schedule</h2>' +
    '<div class="schedule-header">' +
      '<div></div>' +
      '<button class="add-shoot-btn" id="addShootBtn">+ Add Shoot</button>' +
    '</div>' +
    '<div class="week-strip" id="weekStrip"></div>' +
    '<div class="kanban" id="kanban"></div>' +
    '<div class="modal-overlay" id="modalOverlay" hidden></div>';
  c.innerHTML = shell; // nosec — static structure, user content escaped via escHtml below

  c.querySelector('#addShootBtn').addEventListener('click', () => openAddModal(c, shoots));
  renderWeek(c, shoots, getMondayOf(new Date()));
  renderBoard(c, shoots);
}

function renderWeek(c, shoots, weekStart) {
  const strip = c.querySelector('#weekStrip');
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  const shootsByDate = {};
  shoots.forEach(s => {
    if (s.date) {
      if (!shootsByDate[s.date]) shootsByDate[s.date] = [];
      shootsByDate[s.date].push(s);
    }
  });

  const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const dayHTML = days.map((d, i) => {
    const key = isoDate(d);
    const dayShots = shootsByDate[key] || [];
    const dots = dayShots.slice(0, 3).map(s =>
      '<span class="week-dot dot-' + escHtml(s.status) + '"></span>'
    ).join('');
    return (
      '<div class="week-day' + (dayShots.length ? ' has-shoot' : '') + '">' +
        '<div class="week-day-name">' + DAY_NAMES[i] + '</div>' +
        '<div class="week-day-num">' + d.getDate() + '</div>' +
        '<div class="week-dots">' + dots + '</div>' +
      '</div>'
    );
  }).join('');

  const stripHTML =
    '<div class="week-nav">' +
      '<span class="week-label">' + escHtml(fmtDate(weekStart) + ' – ' + fmtDate(end)) + '</span>' +
      '<button class="week-btn" id="prevWeek">‹ Prev</button>' +
      '<button class="week-btn" id="nextWeek">Next ›</button>' +
    '</div>' +
    '<div class="week-days">' + dayHTML + '</div>';
  strip.innerHTML = stripHTML; // nosec — all user data escaped via escHtml above

  const currentStart = new Date(weekStart);
  strip.querySelector('#prevWeek').addEventListener('click', () => {
    currentStart.setDate(currentStart.getDate() - 7);
    renderWeek(c, shoots, new Date(currentStart));
  });
  strip.querySelector('#nextWeek').addEventListener('click', () => {
    currentStart.setDate(currentStart.getDate() + 7);
    renderWeek(c, shoots, new Date(currentStart));
  });
}

function renderBoard(c, shoots) {
  const board = c.querySelector('#kanban');

  const cols = {
    booked:    shoots.filter(s => s.status === 'booked'),
    shooting:  shoots.filter(s => s.status === 'shooting'),
    delivered: shoots.filter(s => s.status === 'delivered'),
  };

  const COL_LABELS = { booked: 'Booked', shooting: 'Shooting', delivered: 'Delivered' };

  const boardHTML = ['booked','shooting','delivered'].map(status => {
    const cards = cols[status];
    const cardsHTML = cards.length
      ? cards.map(s => shootCardHTML(s)).join('')
      : '<p class="empty-col">No shoots</p>';
    return (
      '<div class="kanban-col" data-col="' + status + '">' +
        '<div class="kanban-col-head">' +
          '<span class="col-dot col-dot-' + status + '"></span>' +
          escHtml(COL_LABELS[status]) +
          '<span class="col-count">' + cards.length + '</span>' +
        '</div>' +
        '<div class="kanban-cards">' + cardsHTML + '</div>' +
      '</div>'
    );
  }).join('');
  board.innerHTML = boardHTML; // nosec — all user data escaped via escHtml in shootCardHTML

  board.querySelectorAll('.shoot-card').forEach(card => {
    const id = card.dataset.id;
    const shoot = shoots.find(s => String(s.id) === id);
    if (!shoot) return;

    card.addEventListener('click', e => {
      if (e.target.closest('.shoot-advance-btn') || e.target.closest('.shoot-archive-btn')) return;
      card.classList.toggle('expanded');
    });

    const advBtn = card.querySelector('.shoot-advance-btn');
    if (advBtn) {
      advBtn.addEventListener('click', async () => {
        const next = NEXT_STATUS[shoot.status];
        if (!next) return;
        advBtn.disabled = true;
        try {
          await api.shoots.update(shoot.id, { status: next });
          shoot.status = next;
          renderBoard(c, shoots);
          renderWeek(c, shoots, getMondayOf(new Date()));
        } catch (err) {
          console.error('advance shoot:', err);
          advBtn.disabled = false;
        }
      });
    }

    const archBtn = card.querySelector('.shoot-archive-btn');
    if (archBtn) {
      archBtn.addEventListener('click', async () => {
        archBtn.disabled = true;
        try {
          await api.shoots.archive(shoot.id);
          shoots.splice(shoots.indexOf(shoot), 1);
          renderBoard(c, shoots);
          renderWeek(c, shoots, getMondayOf(new Date()));
        } catch (err) {
          console.error('archive shoot:', err);
          archBtn.disabled = false;
        }
      });
    }
  });
}

function shootCardHTML(s) {
  const dateStr = s.date || 'No date set';
  const sourceTag = s.source === 'inbox' ? 'via inbox' : 'added manually';
  const isDelivered = s.status === 'delivered';
  const advLabel = NEXT_LABEL[s.status] || '';

  return (
    '<div class="shoot-card shoot-card-' + escHtml(s.status) + '" data-id="' + escHtml(String(s.id)) + '">' +
      '<div class="shoot-card-summary">' +
        '<div class="shoot-card-top">' +
          '<span class="shoot-card-name">' + escHtml(s.name) + '</span>' +
          (s.shoot_type ? '<span class="shoot-type-badge">' + escHtml(s.shoot_type) + '</span>' : '') +
        '</div>' +
        '<div class="shoot-card-meta">' + escHtml(dateStr) + (s.contact ? ' · ' + escHtml(s.contact) : '') + '</div>' +
        '<div class="shoot-card-footer">' +
          '<span class="shoot-source-tag">' + escHtml(sourceTag) + '</span>' +
          (isDelivered
            ? '<button class="shoot-archive-btn">Mark Paid → Archive</button>'
            : (advLabel ? '<button class="shoot-advance-btn">' + escHtml(advLabel) + '</button>' : '')) +
        '</div>' +
      '</div>' +
      '<div class="shoot-card-detail">' +
        (s.refs  ? '<p><b>References:</b> ' + escHtml(s.refs)  + '</p>' : '') +
        (s.notes ? '<p><b>Notes:</b> '      + escHtml(s.notes) + '</p>' : '') +
      '</div>' +
    '</div>'
  );
}

function openAddModal(c, shoots) {
  const overlay = c.querySelector('#modalOverlay');
  let selectedType = '';

  const typeChipsHTML = SHOOT_TYPES.map(t =>
    '<button class="type-chip" data-type="' + escHtml(t) + '">' + escHtml(t) + '</button>'
  ).join('');

  const modalHTML =
    '<div class="add-shoot-modal">' +
      '<div class="modal-title">Add Shoot</div>' +
      '<div class="modal-field">' +
        '<label class="modal-label">Name</label>' +
        '<input class="modal-input" id="mName" placeholder="Client name" />' +
      '</div>' +
      '<div class="modal-field">' +
        '<label class="modal-label">Shoot Type</label>' +
        '<div class="modal-type-chips">' + typeChipsHTML + '</div>' +
      '</div>' +
      '<div class="modal-field">' +
        '<label class="modal-label">Contact (Discord / Phone)</label>' +
        '<input class="modal-input" id="mContact" placeholder="discord: name#0000" />' +
      '</div>' +
      '<div class="modal-field">' +
        '<label class="modal-label">Date</label>' +
        '<input class="modal-input" id="mDate" type="date" />' +
      '</div>' +
      '<div class="modal-field">' +
        '<label class="modal-label">References</label>' +
        '<textarea class="modal-textarea" id="mRefs" placeholder="Reference links or notes…"></textarea>' +
      '</div>' +
      '<div class="modal-field">' +
        '<label class="modal-label">Notes</label>' +
        '<textarea class="modal-textarea" id="mNotes" placeholder="Additional notes…"></textarea>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="modal-cancel" id="mCancel">Cancel</button>' +
        '<button class="modal-save" id="mSave">Add Shoot</button>' +
      '</div>' +
    '</div>';
  overlay.innerHTML = modalHTML; // nosec — static structure, no user data in this template

  overlay.removeAttribute('hidden');

  overlay.querySelectorAll('.type-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      overlay.querySelectorAll('.type-chip').forEach(c2 => c2.classList.remove('selected'));
      chip.classList.add('selected');
      selectedType = chip.dataset.type;
    });
  });

  overlay.querySelector('#mCancel').addEventListener('click', () => overlay.setAttribute('hidden', ''));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.setAttribute('hidden', ''); });

  overlay.querySelector('#mSave').addEventListener('click', async () => {
    const name    = overlay.querySelector('#mName').value.trim();
    const contact = overlay.querySelector('#mContact').value.trim();
    const date    = overlay.querySelector('#mDate').value;
    const refs    = overlay.querySelector('#mRefs').value.trim();
    const notes   = overlay.querySelector('#mNotes').value.trim();

    const nameInput    = overlay.querySelector('#mName');
    const contactInput = overlay.querySelector('#mContact');
    nameInput.style.borderColor    = name    ? '' : 'var(--accent)';
    contactInput.style.borderColor = contact ? '' : 'var(--accent)';
    if (!name || !contact) return;

    const btn = overlay.querySelector('#mSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { id } = await api.shoots.create({
        name,
        shoot_type: selectedType || null,
        contact,
        date: date || null,
        refs: refs || null,
        notes: notes || null
      });
      shoots.push({ id, name, shoot_type: selectedType || null, contact, date: date || null, refs: refs || null, notes: notes || null, status: 'booked', source: 'manual' });
      overlay.setAttribute('hidden', '');
      renderBoard(c, shoots);
      renderWeek(c, shoots, getMondayOf(new Date()));
    } catch (err) {
      console.error('createShoot:', err);
      btn.disabled = false;
      btn.textContent = 'Add Shoot';
    }
  });
}

import { api } from '../api.js';

const NEXT  = { new:'seen', seen:'booked', booked:'done', done:'new' };
const LABEL = { new:'New', seen:'Seen', booked:'Booked', done:'Done' };

export async function initInbox(c) {
  c.textContent = 'Loading…';
  let commissions;
  try {
    ({ commissions } = await api.commissions.list());
  } catch (err) {
    c.textContent = 'Failed to load inbox. Check your connection.';
    console.error('initInbox:', err);
    return;
  }
  renderInbox(c, commissions);
}

function renderInbox(c, list) {
  c.innerHTML = '<h2 class="view-title">Inbox</h2><div id="inboxList" class="inbox-list"></div>'; // nosec
  const ul = c.querySelector('#inboxList');

  if (!list.length) {
    ul.textContent = 'No commission requests yet.';
    return;
  }

  list.forEach(com => {
    const row = document.createElement('div');
    row.className = 'inbox-row border-' + com.status;
    row.dataset.cid = com.id;

    const summary = document.createElement('div');
    summary.className = 'inbox-summary';

    const nameEl    = document.createElement('span'); nameEl.className = 'inbox-name';    nameEl.textContent = com.name;
    const typeEl    = document.createElement('span'); typeEl.className = 'inbox-type';    typeEl.textContent = com.shoot_type || '—';
    const contactEl = document.createElement('span'); contactEl.className = 'inbox-contact'; contactEl.textContent = com.contact;
    const dateEl    = document.createElement('span'); dateEl.className = 'inbox-date';    dateEl.textContent = String(com.created_at).slice(0, 10);
    const btn       = document.createElement('button');
    btn.className = 'status-btn s-' + com.status;
    btn.dataset.status = com.status;
    btn.textContent = LABEL[com.status];

    summary.append(nameEl, typeEl, contactEl, dateEl, btn);

    const detail = document.createElement('div');
    detail.className = 'inbox-detail';

    [['Deadline', com.deadline], ['References', com.refs], ['Notes', com.notes]].forEach(([label, val]) => {
      if (!val) return;
      const p = document.createElement('p');
      const b = document.createElement('b');
      b.textContent = label + ': ';
      p.appendChild(b);
      p.appendChild(document.createTextNode(val));
      detail.appendChild(p);
    });

    row.append(summary, detail);

    summary.addEventListener('click', e => {
      if (e.target === btn) {
        const prev = btn.dataset.status;
        const next = NEXT[prev];
        if (!next) return; // unknown status — skip
        api.commissions.updateStatus(com.id, next)
          .then(() => {
            btn.dataset.status = next;
            btn.textContent = LABEL[next];
            btn.className = 'status-btn s-' + next;
            row.className = 'inbox-row border-' + next;
          })
          .catch(err => {
            console.error('Failed to update commission status:', err);
          });
      } else {
        row.classList.toggle('expanded');
      }
    });

    ul.appendChild(row);
  });
}

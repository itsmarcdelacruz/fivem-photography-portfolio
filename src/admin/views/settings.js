import { api } from '../api.js';

export async function initSettings(c) {
  c.textContent = 'Loading…';
  const s = await api.settings.get();

  const h2 = document.createElement('h2');
  h2.className = 'view-title';
  h2.textContent = 'Settings';

  const card = document.createElement('div');
  card.className = 'settings-card';

  const checkRow = document.createElement('div');
  checkRow.className = 'settings-row';
  const labelInfo = document.createElement('div');
  const lbl = document.createElement('div'); lbl.className = 'settings-label'; lbl.textContent = 'Commission availability';
  const hint = document.createElement('div'); hint.className = 'settings-hint'; hint.textContent = 'Controls the badge on the public site';
  labelInfo.append(lbl, hint);

  const checkLabel = document.createElement('label');
  checkLabel.className = 'toggle-switch';
  const check = document.createElement('input');
  check.type = 'checkbox'; check.id = 'availCheck'; if (s.availability === 'open') check.checked = true;
  const track = document.createElement('span'); track.className = 'toggle-track';
  checkLabel.append(check, track);
  checkRow.append(labelInfo, checkLabel);

  const labelRow = document.createElement('div');
  labelRow.className = 'settings-row';
  const lblBadge = document.createElement('label');
  lblBadge.className = 'settings-label'; lblBadge.htmlFor = 'availLabel'; lblBadge.textContent = 'Badge text';
  const input = document.createElement('input');
  input.type = 'text'; input.id = 'availLabel'; input.className = 'settings-input';
  input.value = s.availability_label || ''; input.placeholder = 'Open for July';
  labelRow.append(lblBadge, input);

  const btn = document.createElement('button');
  btn.className = 'save-btn'; btn.textContent = 'Save';
  btn.addEventListener('click', async () => {
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      await api.settings.update({ availability: check.checked ? 'open' : 'closed', availability_label: input.value.trim() });
      btn.textContent = 'Saved!';
    } catch (err) {
      console.error('Failed to save settings:', err);
      btn.textContent = 'Error — try again';
    } finally {
      setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
    }
  });

  card.append(checkRow, labelRow, btn);
  // c.textContent = '' clears only the loading text — no user data involved
  c.textContent = '';
  c.append(h2, card);
}

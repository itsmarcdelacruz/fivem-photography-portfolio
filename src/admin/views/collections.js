import { api } from '../api.js';
import { collectionPayload, collectionStatus, slugFromTitle } from '../collection-form.js';

export async function initCollections(container) {
  container.textContent = 'Loading…';
  try {
    const [{ collections }, { photos }] = await Promise.all([
      api.collections.list(), api.photos.adminList()
    ]);
    renderCollectionList(container, collections, photos);
  } catch {
    container.innerHTML = '<div class="admin-error">Collections could not be loaded. <button data-retry>Retry</button></div>';
    container.querySelector('[data-retry]').addEventListener('click', () => initCollections(container));
  }
}

function renderCollectionList(container, collections, photos) {
  container.innerHTML =
    '<div class="collections-head"><h2 class="view-title">Collections</h2>' +
    '<button class="primary-btn" data-new-collection>New collection</button></div>' +
    '<div class="collection-workspace"><div class="collection-list"></div>' +
    '<div class="collection-editor"><p>Select a collection or create one.</p></div></div>';
  const list = container.querySelector('.collection-list');
  for (const collection of collections) {
    const button = document.createElement('button');
    button.className = 'collection-row';
    button.dataset.collectionId = collection.id;
    button.innerHTML = '<span class="collection-row-title"></span><span class="collection-row-state"></span>';
    button.querySelector('.collection-row-title').textContent = collection.title;
    button.querySelector('.collection-row-state').textContent = collectionStatus(collection);
    button.draggable = true;
    button.addEventListener('click', async () => {
      const { collection: detail } = await api.collections.get(collection.id);
      renderEditor(container.querySelector('.collection-editor'), detail, photos);
    });
    list.appendChild(button);
  }
  let dragging = null;
  list.addEventListener('dragstart', event => {
    dragging = event.target.closest('[data-collection-id]');
  });
  list.addEventListener('dragover', event => {
    event.preventDefault();
    const target = event.target.closest('[data-collection-id]');
    if (!dragging || !target || target === dragging) return;
    const box = target.getBoundingClientRect();
    list.insertBefore(dragging, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
  });
  list.addEventListener('drop', async event => {
    event.preventDefault();
    await api.collections.reorder(
      [...list.querySelectorAll('[data-collection-id]')].map(row => row.dataset.collectionId)
    );
    dragging = null;
  });
  container.querySelector('[data-new-collection]').addEventListener('click', () => {
    renderEditor(container.querySelector('.collection-editor'), {
      id: null, title: '', slug: '', introduction: '', location: '',
      event_date: '', cover_photo_id: '', is_published: 0, photos: []
    }, photos);
  });
}

function renderEditor(editor, collection, allPhotos) {
  editor.innerHTML =
    '<form class="collection-form">' +
      '<label>Title<input name="title" required maxlength="120"></label>' +
      '<label>Slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></label>' +
      '<label>Introduction<textarea name="introduction" maxlength="1200"></textarea></label>' +
      '<div class="field-row"><label>Location<input name="location"></label>' +
      '<label>Event date<input name="event_date" type="date"></label></div>' +
      '<label>Cover photo<select name="cover_photo_id"><option value="">First visible frame</option></select></label>' +
      '<label class="publish-toggle"><input name="is_published" type="checkbox"> Published</label>' +
      '<div class="collection-actions"><button type="button" data-preview>Preview</button>' +
      '<button type="button" class="danger-btn" data-delete-collection>Delete</button>' +
      '<button class="primary-btn" type="submit">Save collection</button></div>' +
    '</form><div class="collection-members"><h3>Story sequence</h3>' +
    '<button type="button" data-add-photos>Add photos</button><div class="collection-sequence"></div></div>' +
    '<p class="save-state" aria-live="polite"></p>';
  const form = editor.querySelector('form');
  for (const key of ['title', 'slug', 'introduction', 'location', 'event_date']) {
    form.elements[key].value = collection[key] || '';
  }
  form.elements.is_published.checked = Number(collection.is_published) === 1;
  const cover = form.elements.cover_photo_id;
  for (const photo of allPhotos) {
    cover.add(new Option(photo.title, photo.id, false, photo.id === collection.cover_photo_id));
  }
  renderSequence(editor.querySelector('.collection-sequence'), collection.photos || []);
  let dirty = false;
  form.addEventListener('input', () => { dirty = true; });
  window.onbeforeunload = event => {
    if (!dirty) return undefined;
    event.preventDefault();
    return '';
  };
  form.elements.title.addEventListener('input', () => {
    if (!collection.id && !form.elements.slug.dataset.edited) {
      form.elements.slug.value = slugFromTitle(form.elements.title.value);
    }
  });
  form.elements.slug.addEventListener('input', () => { form.elements.slug.dataset.edited = '1'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const payload = collectionPayload(Object.fromEntries(new FormData(form)));
    payload.is_published = form.elements.is_published.checked;
    const saved = collection.id
      ? await api.collections.update(collection.id, payload)
      : await api.collections.create(payload);
    const id = collection.id || saved.collection.id;
    const ordered = [...editor.querySelectorAll('[data-photo-id]')].map(card => ({
      photo_id: card.dataset.photoId,
      caption: card.querySelector('input').value
    }));
    await api.collections.replacePhotos(id, ordered);
    dirty = false;
    editor.querySelector('.save-state').textContent = 'Saved.';
  });
  editor.querySelector('[data-add-photos]').addEventListener('click', () => {
    openPhotoPicker(editor, allPhotos);
  });
  editor.querySelector('[data-preview]').addEventListener('click', () => {
    const preview = document.createElement('dialog');
    preview.className = 'collection-preview';
    const heading = document.createElement('h2');
    heading.textContent = form.elements.title.value || 'Untitled collection';
    const intro = document.createElement('p');
    intro.textContent = form.elements.introduction.value;
    const frames = editor.querySelector('.collection-sequence').cloneNode(true);
    frames.querySelectorAll('input,button').forEach(control => control.remove());
    const close = document.createElement('button');
    close.textContent = 'Close preview';
    close.addEventListener('click', () => preview.close());
    preview.append(heading, intro, frames, close);
    editor.appendChild(preview);
    preview.addEventListener('close', () => preview.remove(), { once: true });
    preview.showModal();
  });
  const deleteButton = editor.querySelector('[data-delete-collection]');
  deleteButton.hidden = !collection.id;
  deleteButton.addEventListener('click', async () => {
    if (!collection.id || !confirm(`Delete "${collection.title}"? The photos will be kept.`)) return;
    await api.collections.remove(collection.id);
    window.onbeforeunload = null;
    await initCollections(editor.closest('.admin-main'));
  });
}

function renderSequence(root, photos) {
  root.textContent = '';
  for (const photo of photos) {
    const card = document.createElement('article');
    card.className = 'sequence-card';
    card.dataset.photoId = photo.id;
    card.draggable = true;
    const image = document.createElement('img');
    image.src = photo.thumb_url;
    image.alt = '';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = photo.title;
    const caption = document.createElement('input');
    caption.value = photo.caption || '';
    caption.maxLength = 500;
    caption.placeholder = 'Story-specific caption';
    copy.append(title, caption);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => card.remove());
    card.append(image, copy, remove);
    root.appendChild(card);
  }
  let dragging = null;
  root.addEventListener('dragstart', event => {
    dragging = event.target.closest('[data-photo-id]');
    dragging?.classList.add('dragging');
  });
  root.addEventListener('dragover', event => {
    event.preventDefault();
    const target = event.target.closest('[data-photo-id]');
    if (!dragging || !target || target === dragging) return;
    const box = target.getBoundingClientRect();
    root.insertBefore(dragging, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
  });
  root.addEventListener('dragend', () => {
    dragging?.classList.remove('dragging');
    dragging = null;
  });
}

function openPhotoPicker(editor, allPhotos) {
  const existing = new Set(
    [...editor.querySelectorAll('.collection-sequence [data-photo-id]')]
      .map(card => card.dataset.photoId)
  );
  const dialog = document.createElement('dialog');
  dialog.className = 'photo-picker';
  const form = document.createElement('form');
  form.method = 'dialog';
  for (const photo of allPhotos.filter(item => !existing.has(item.id))) {
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = photo.id;
    check.dataset.photoTitle = photo.title;
    check.dataset.photoThumb = photo.thumb_url;
    label.append(check, document.createTextNode(photo.title));
    form.appendChild(label);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add selected';
  add.addEventListener('click', () => {
    const additions = [...form.querySelectorAll('input:checked')].map(input => ({
      id: input.value,
      title: input.dataset.photoTitle,
      thumb_url: input.dataset.photoThumb,
      caption: ''
    }));
    const current = [...editor.querySelectorAll('.collection-sequence [data-photo-id]')].map(card => ({
      id: card.dataset.photoId,
      title: card.querySelector('strong').textContent,
      thumb_url: card.querySelector('img').src,
      caption: card.querySelector('input').value
    }));
    renderSequence(editor.querySelector('.collection-sequence'), [...current, ...additions]);
    dialog.close();
  });
  const cancel = document.createElement('button');
  cancel.value = 'cancel';
  cancel.textContent = 'Cancel';
  form.append(add, cancel);
  dialog.appendChild(form);
  editor.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

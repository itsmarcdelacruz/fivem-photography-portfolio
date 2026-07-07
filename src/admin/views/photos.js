import { api } from '../api.js';
import { createUploadQueue } from '../upload-queue.js';
import { hashFile, uploadPhoto } from '../upload.js';
import { CATS } from '../../data.js';

const categories = CATS.filter((category) => category.id !== 'all');

export function toggleSelection(current, id, selected) {
  const next = new Set(current);
  selected ? next.add(id) : next.delete(id);
  return next;
}

export async function initPhotos(c) {
  c.textContent = 'Loading…';
  try {
    const [{ photos }, { collections }] = await Promise.all([
      api.photos.adminList(),
      api.collections.list()
    ]);
    renderPhotos(c, photos, collections);
  } catch (err) {
    c.textContent = 'Failed to load photos. Check your connection.';
    console.error('initPhotos:', err);
  }
}

function appendOptions(select, items, selectedValue) {
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.title || item.name;
    option.selected = item.id === selectedValue;
    select.appendChild(option);
  });
}

function renderPhotos(c, photos, collections) {
  c.innerHTML =
    '<div class="photos-head"><h2 class="view-title" style="margin:0">Photos</h2>' +
    '<label class="upload-btn">+ Upload<input type="file" id="photoInput" accept="image/*" multiple hidden></label></div>' +
    '<div class="upload-drop" id="uploadDrop">Drop images here to upload</div>' +
    '<div class="upload-options">' +
    '<label>Category<select id="uploadCategory"></select></label>' +
    '<label>Collection<select id="uploadCollection"><option value="">None</option></select></label>' +
    '</div>' +
    '<div id="uploadQueue" class="upload-queue"></div>' +
    '<p class="upload-summary" data-upload-summary aria-live="polite"></p>' +
    '<div id="bulkToolbar" class="bulk-toolbar" hidden>' +
    '<strong><span data-selected-count>0</span> selected</strong>' +
    '<select data-bulk-category><option value="">Change category…</option></select>' +
    '<select data-bulk-collection><option value="">Add to collection…</option></select>' +
    '<button data-bulk-hide>Unpublish</button><button data-bulk-show>Publish</button>' +
    '<button data-bulk-delete class="danger-btn">Delete</button>' +
    '</div><p class="reorder-error" data-reorder-error aria-live="polite"></p>' +
    '<div class="photo-grid" id="photoGrid"></div>';

  const grid = c.querySelector('#photoGrid');
  const uploadCategory = c.querySelector('#uploadCategory');
  const uploadCollection = c.querySelector('#uploadCollection');
  const bulkCategory = c.querySelector('[data-bulk-category]');
  const bulkCollection = c.querySelector('[data-bulk-collection]');
  appendOptions(uploadCategory, categories, 'portraits');
  appendOptions(uploadCollection, collections);
  appendOptions(bulkCategory, categories);
  appendOptions(bulkCollection, collections);

  const photoMap = new Map(photos.map((photo) => [String(photo.id), photo]));
  photos.forEach((photo) => grid.appendChild(makeCard(photo)));
  let selected = new Set();

  const syncSelection = () => {
    c.querySelector('#bulkToolbar').hidden = selected.size === 0;
    c.querySelector('[data-selected-count]').textContent = String(selected.size);
    grid.querySelectorAll('[data-photo-id]').forEach((card) => {
      const isSelected = selected.has(card.dataset.photoId);
      card.classList.toggle('selected', isSelected);
      card.querySelector('.photo-select input').checked = isSelected;
    });
  };

  const queue = createUploadQueue({
    uploadOne: async (file, context, onProgress) => {
      const hash = await hashFile(file);
      const duplicate = await api.photos.findHash(hash);
      if (
        duplicate.photo &&
        !confirm(`"${file.name}" appears to already exist. Upload another copy?`)
      ) {
        throw new Error('Skipped duplicate');
      }
      const uploaded = await uploadPhoto(file, onProgress);
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const created = await api.photos.create({
        title,
        category: context.category,
        meta: '',
        alt_text: '',
        is_published: true,
        thumb_url: uploaded.thumbUrl,
        full_url: uploaded.fullUrl,
        aspect_ratio: uploaded.aspectRatio,
        content_hash: uploaded.contentHash,
        upload_keys: uploaded.uploadKeys
      });
      if (context.collectionId) {
        await api.photos.batch({
          photo_ids: [created.id],
          changes: {},
          add_collection_ids: [context.collectionId],
          remove_collection_ids: []
        });
      }
      const photo = {
        ...created,
        ...uploaded,
        id: created.id,
        thumb_url: uploaded.thumbUrl,
        title,
        category: context.category
      };
      photoMap.set(String(photo.id), photo);
      grid.prepend(makeCard(photo));
      return { ...uploaded, photoId: created.id, title };
    }
  });

  const queueElement = c.querySelector('#uploadQueue');
  const queueSummary = c.querySelector('[data-upload-summary]');
  queue.subscribe((items) => {
    queueElement.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement('div');
        row.className = 'upload-item';
        row.dataset.status = item.status;
        const name = document.createElement('strong');
        name.textContent = item.file.name;
        const status = document.createElement('span');
        status.textContent = `${item.status}: ${item.error || item.message}`;
        row.append(name, status);
        if (item.status === 'failed' || item.status === 'queued') {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = item.status === 'failed' ? 'Retry' : 'Cancel';
          button.addEventListener('click', () =>
            item.status === 'failed'
              ? queue.retry(item.id, uploadContext(c))
              : queue.cancel(item.id)
          );
          row.appendChild(button);
        }
        return row;
      })
    );
    if (items.length && items.every((item) => !['queued', 'uploading'].includes(item.status))) {
      const complete = items.filter((item) => item.status === 'complete').length;
      const skipped = items.filter(
        (item) => item.status === 'cancelled' || item.error === 'Skipped duplicate'
      ).length;
      const failed = items.filter(
        (item) => item.status === 'failed' && item.error !== 'Skipped duplicate'
      ).length;
      queueSummary.textContent = `${complete} complete, ${failed} failed, ${skipped} cancelled/skipped`;
    } else {
      queueSummary.textContent = '';
    }
  });

  const addFiles = (files) => {
    if (!files.length) return;
    queue.add(files);
    queue.run(uploadContext(c));
  };
  c.querySelector('#photoInput').addEventListener('change', (event) =>
    addFiles(Array.from(event.target.files))
  );
  const drop = c.querySelector('#uploadDrop');
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('drag-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drag-over');
    addFiles(Array.from(event.dataTransfer.files));
  });

  grid.addEventListener('change', (event) => {
    if (!event.target.matches('.photo-select input')) return;
    const id = event.target.closest('[data-photo-id]').dataset.photoId;
    selected = toggleSelection(selected, id, event.target.checked);
    syncSelection();
  });
  grid.addEventListener('click', async (event) => {
    const card = event.target.closest('[data-photo-id]');
    if (!card) return;
    const photo = photoMap.get(card.dataset.photoId);
    if (event.target.closest('.photo-edit')) openMetadataDrawer(c, photo, card);
    if (event.target.closest('.photo-delete') && (await removePhotoWithUsage(photo))) {
      selected.delete(card.dataset.photoId);
      photoMap.delete(card.dataset.photoId);
      card.remove();
      syncSelection();
    }
  });

  let draggedCard = null;
  let orderBeforeDrag = [];
  let droppedInGrid = false;
  const restoreOrder = () => orderBeforeDrag.forEach((card) => grid.appendChild(card));
  grid.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-photo-id]');
    if (!card) return;
    draggedCard = card;
    orderBeforeDrag = [...grid.querySelectorAll('[data-photo-id]')];
    droppedInGrid = false;
    c.querySelector('[data-reorder-error]').textContent = '';
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  grid.addEventListener('dragend', () => {
    draggedCard?.classList.remove('dragging');
    if (draggedCard && !droppedInGrid) restoreOrder();
    draggedCard = null;
    if (!droppedInGrid) orderBeforeDrag = [];
  });
  grid.addEventListener('dragover', (event) => {
    event.preventDefault();
    const target = event.target.closest('[data-photo-id]');
    if (!target || !draggedCard || target === draggedCard) return;
    const cards = [...grid.querySelectorAll('[data-photo-id]')];
    if (cards.indexOf(draggedCard) < cards.indexOf(target)) {
      grid.insertBefore(draggedCard, target.nextSibling);
    } else {
      grid.insertBefore(draggedCard, target);
    }
  });
  grid.addEventListener('drop', async (event) => {
    event.preventDefault();
    if (!draggedCard) return;
    droppedInGrid = true;
    draggedCard.classList.remove('dragging');
    const cards = [...grid.querySelectorAll('[data-photo-id]')];
    try {
      await api.photos.reorder(cards.map((card) => card.dataset.photoId));
    } catch (error) {
      restoreOrder();
      c.querySelector('[data-reorder-error]').textContent =
        `Could not save photo order: ${error.message}. Try again.`;
      console.error('Failed to reorder photos:', error);
    } finally {
      draggedCard = null;
      orderBeforeDrag = [];
      droppedInGrid = false;
    }
  });

  const batch = async (changes, addCollectionIds = []) => {
    const ids = [...selected];
    if (!ids.length) return;
    await api.photos.batch({
      photo_ids: ids,
      changes,
      add_collection_ids: addCollectionIds,
      remove_collection_ids: []
    });
    ids.forEach((id) => {
      Object.assign(photoMap.get(id), changes);
      const card = [...grid.querySelectorAll('[data-photo-id]')].find(
        (item) => item.dataset.photoId === id
      );
      if (changes.category)
        card.querySelector('.photo-category').textContent = categoryLabel(changes.category);
      if ('is_published' in changes) card.classList.toggle('unpublished', !changes.is_published);
    });
  };
  bulkCategory.addEventListener('change', async (event) => {
    if (event.target.value) await batch({ category: event.target.value });
    event.target.value = '';
  });
  bulkCollection.addEventListener('change', async (event) => {
    if (event.target.value) await batch({}, [event.target.value]);
    event.target.value = '';
  });
  c.querySelector('[data-bulk-hide]').addEventListener('click', () =>
    batch({ is_published: false })
  );
  c.querySelector('[data-bulk-show]').addEventListener('click', () =>
    batch({ is_published: true })
  );
  c.querySelector('[data-bulk-delete]').addEventListener('click', async () => {
    for (const id of [...selected]) {
      const photo = photoMap.get(id);
      if (await removePhotoWithUsage(photo)) {
        [...grid.querySelectorAll('[data-photo-id]')]
          .find((item) => item.dataset.photoId === id)
          ?.remove();
        photoMap.delete(id);
        selected.delete(id);
      }
    }
    syncSelection();
  });
}

function uploadContext(c) {
  return {
    category: c.querySelector('#uploadCategory').value,
    collectionId: c.querySelector('#uploadCollection').value || null
  };
}

function categoryLabel(id) {
  return categories.find((category) => category.id === id)?.label || id;
}

function makeCard(photo) {
  const card = document.createElement('div');
  card.className = `photo-card${photo.is_published === false ? ' unpublished' : ''}`;
  card.dataset.photoId = photo.id;
  card.draggable = true;
  const image = document.createElement('img');
  image.src = photo.thumb_url;
  image.alt = photo.alt_text || photo.title;
  image.loading = 'lazy';
  const select = document.createElement('label');
  select.className = 'photo-select';
  select.innerHTML = '<input type="checkbox" aria-label="Select photo">';
  const info = document.createElement('div');
  info.className = 'photo-card-info';
  const title = document.createElement('span');
  title.className = 'photo-title';
  title.textContent = photo.title;
  const category = document.createElement('span');
  category.className = 'photo-category';
  category.textContent = categoryLabel(photo.category);
  const edit = document.createElement('button');
  edit.className = 'photo-edit';
  edit.type = 'button';
  edit.textContent = 'Edit metadata';
  const remove = document.createElement('button');
  remove.className = 'photo-delete';
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Delete photo');
  remove.textContent = '×';
  info.append(title, category, edit);
  card.append(image, select, info, remove);
  return card;
}

function openMetadataDrawer(c, photo, card) {
  c.querySelector('.photo-metadata-drawer')?.remove();
  const drawer = document.createElement('aside');
  drawer.className = 'photo-metadata-drawer';
  drawer.innerHTML =
    '<button type="button" data-close aria-label="Close metadata editor">×</button><h3>Edit metadata</h3>' +
    '<form class="metadata-form">' +
    '<label>Title<input name="title" required></label><label>Metadata<textarea name="meta"></textarea></label>' +
    '<label>Alt text<input name="alt_text"></label><label>Category<select name="category"></select></label>' +
    '<label><input type="checkbox" name="is_published"> Published</label><button type="submit">Save</button>' +
    '<p class="save-state" aria-live="polite"></p></form>';
  const form = drawer.querySelector('form');
  form.elements.title.value = photo.title || '';
  form.elements.meta.value = photo.meta || '';
  form.elements.alt_text.value = photo.alt_text || '';
  appendOptions(form.elements.category, categories, photo.category);
  form.elements.is_published.checked = photo.is_published !== false;
  drawer.querySelector('[data-close]').addEventListener('click', () => drawer.remove());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const state = form.querySelector('.save-state');
    const changes = {
      title: form.elements.title.value,
      meta: form.elements.meta.value,
      alt_text: form.elements.alt_text.value,
      category: form.elements.category.value,
      is_published: form.elements.is_published.checked
    };
    state.textContent = 'Saving…';
    try {
      await api.photos.update(photo.id, changes);
      Object.assign(photo, changes);
      card.querySelector('.photo-title').textContent = changes.title;
      card.querySelector('.photo-category').textContent = categoryLabel(changes.category);
      card.querySelector('img').alt = changes.alt_text || changes.title;
      card.classList.toggle('unpublished', !changes.is_published);
      state.textContent = 'Saved.';
    } catch (error) {
      state.textContent = `Save failed: ${error.message}`;
    }
  });
  c.appendChild(drawer);
}

async function removePhotoWithUsage(photo) {
  if (!confirm(`Delete "${photo.title}"?`)) return false;
  try {
    await api.photos.remove(photo.id);
    return true;
  } catch (error) {
    if (error.status !== 409) throw error;
    const usage = error.data?.usage || {};
    const message =
      `"${photo.title}" is used in ${Number(usage.collection_count || 0)} collection(s)` +
      (Number(usage.cover_count || 0) ? ' and is a collection cover.' : '.') +
      ' Delete it everywhere?';
    if (!confirm(message)) return false;
    await api.photos.remove(photo.id, true);
    return true;
  }
}

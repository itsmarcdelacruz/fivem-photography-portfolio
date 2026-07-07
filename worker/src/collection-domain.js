export function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function validateCollectionInput(input, { partial = false } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  if (!partial && !String(body.title || '').trim()) return { error: 'title is required' };
  if (!partial && !String(body.slug || '').trim()) return { error: 'slug is required' };
  if (body.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(body.slug))) {
    return { error: 'slug is invalid' };
  }
  const value = {};
  if (body.title !== undefined) value.title = String(body.title).trim().slice(0, 120);
  if (body.slug !== undefined) value.slug = String(body.slug);
  if (body.introduction !== undefined) {
    value.introduction = String(body.introduction).trim().slice(0, 1200);
  }
  for (const key of ['location', 'event_date', 'cover_photo_id']) {
    if (body[key] !== undefined) value[key] = String(body[key] || '').trim() || null;
  }
  if (body.is_published !== undefined) value.is_published = body.is_published ? 1 : 0;
  return { value };
}

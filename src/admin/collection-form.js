export function slugFromTitle(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function collectionPayload(values) {
  return {
    title: String(values.title || '').trim(),
    slug: String(values.slug || '').trim(),
    introduction: String(values.introduction || '').trim(),
    location: String(values.location || '').trim() || null,
    event_date: String(values.event_date || '').trim() || null,
    cover_photo_id: String(values.cover_photo_id || '').trim() || null,
    is_published: Boolean(values.is_published)
  };
}

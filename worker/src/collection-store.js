export async function listPublishedCollections(db) {
  const { rows } = await db.execute(`
    SELECT c.*,
      COALESCE(cp_count.frame_count, 0) AS frame_count,
      COALESCE(cover.thumb_url, (
        SELECT p.thumb_url
        FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
        WHERE cp.collection_id=c.id AND p.is_published=1
        ORDER BY cp.sort_order ASC, p.created_at ASC, p.id ASC
        LIMIT 1
      )) AS cover_thumb_url
    FROM collections c
    LEFT JOIN photos cover ON cover.id=c.cover_photo_id AND cover.is_published=1
    LEFT JOIN (
      SELECT collection_id, COUNT(*) AS frame_count
      FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
      WHERE p.is_published=1 GROUP BY collection_id
    ) cp_count ON cp_count.collection_id=c.id
    WHERE c.is_published=1
    ORDER BY c.sort_order ASC, c.created_at DESC
  `);
  return rows;
}

export async function findPublishedCollection(db, slug) {
  const found = await db.execute({
    sql: 'SELECT * FROM collections WHERE slug=? AND is_published=1',
    args: [slug]
  });
  if (!found.rows.length) return null;
  const collection = found.rows[0];
  const photos = await db.execute({
    sql: `SELECT p.*, cp.caption
          FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
          WHERE cp.collection_id=? AND p.is_published=1
          ORDER BY cp.sort_order ASC`,
    args: [collection.id]
  });
  return { ...collection, photos: photos.rows };
}

export async function replaceCollectionPhotos(db, collectionId, items) {
  if (items.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('each photo must be an object');
  }
  const normalized = items.map((item, index) => ({
    photo_id: String(item.photo_id || ''),
    caption:
      String(item.caption || '')
        .trim()
        .slice(0, 500) || null,
    sort_order: index
  }));
  if (normalized.some((item) => !item.photo_id)) throw new Error('photo_id is required');
  const statements = [
    { sql: 'DELETE FROM collection_photos WHERE collection_id=?', args: [collectionId] },
    ...normalized.map((item) => ({
      sql: `INSERT INTO collection_photos
            (collection_id,photo_id,sort_order,caption) VALUES (?,?,?,?)`,
      args: [collectionId, item.photo_id, item.sort_order, item.caption]
    }))
  ];
  await db.batch(statements, 'write');
}

export async function getAdminCollection(db, id) {
  const found = await db.execute({ sql: 'SELECT * FROM collections WHERE id=?', args: [id] });
  if (!found.rows.length) return null;
  const photos = await db.execute({
    sql: `SELECT p.*, cp.caption FROM collection_photos cp
          JOIN photos p ON p.id=cp.photo_id
          WHERE cp.collection_id=? ORDER BY cp.sort_order`,
    args: [id]
  });
  return { ...found.rows[0], photos: photos.rows };
}

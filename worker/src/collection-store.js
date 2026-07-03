export async function listPublishedCollections(db) {
  const { rows } = await db.execute(`
    SELECT c.*,
      COALESCE(cp_count.frame_count, 0) AS frame_count,
      COALESCE(cover.thumb_url, first_photo.thumb_url) AS cover_thumb_url
    FROM collections c
    LEFT JOIN photos cover ON cover.id=c.cover_photo_id AND cover.is_published=1
    LEFT JOIN (
      SELECT collection_id, COUNT(*) AS frame_count
      FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
      WHERE p.is_published=1 GROUP BY collection_id
    ) cp_count ON cp_count.collection_id=c.id
    LEFT JOIN (
      SELECT cp.collection_id, p.thumb_url
      FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id
      WHERE p.is_published=1 AND cp.sort_order=(
        SELECT MIN(cp2.sort_order) FROM collection_photos cp2
        JOIN photos p2 ON p2.id=cp2.photo_id
        WHERE cp2.collection_id=cp.collection_id AND p2.is_published=1
      )
    ) first_photo ON first_photo.collection_id=c.id
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

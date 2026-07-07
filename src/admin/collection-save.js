export async function saveCollection(collectionApi, collection, payload, photos) {
  const requestedPublished = Boolean(payload.is_published);
  const wasPublished = Number(collection.is_published) === 1;
  const metadata = { ...payload };
  delete metadata.is_published;

  if (!collection.id) {
    const saved = await collectionApi.create({ ...metadata, is_published: false });
    const id = saved.collection.id;
    collection.id = id;
    collection.is_published = 0;
    await collectionApi.replacePhotos(id, photos);
    if (requestedPublished) await collectionApi.update(id, { is_published: true });
    collection.is_published = requestedPublished ? 1 : 0;
    return { id, is_published: requestedPublished ? 1 : 0 };
  }

  if (wasPublished && !requestedPublished) {
    await collectionApi.update(collection.id, { ...metadata, is_published: false });
  } else {
    await collectionApi.update(collection.id, metadata);
  }
  await collectionApi.replacePhotos(collection.id, photos);
  if (requestedPublished) {
    await collectionApi.update(collection.id, { is_published: true });
  }
  return { id: collection.id, is_published: requestedPublished ? 1 : 0 };
}

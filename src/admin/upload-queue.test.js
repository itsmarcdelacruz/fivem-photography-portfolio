import { describe, expect, it, vi } from 'vitest';
import { createUploadQueue } from './upload-queue.js';

describe('createUploadQueue', () => {
  it('continues after one file fails and retries only that item', async () => {
    const uploadOne = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ photoId: 'two' })
      .mockResolvedValue({ photoId: 'one' });
    const queue = createUploadQueue({ uploadOne });
    queue.add([new File(['a'], 'one.png'), new File(['b'], 'two.png')]);

    await queue.run({ category: 'portraits', collectionId: null });

    expect(queue.items().map(item => item.status)).toEqual(['failed', 'complete']);
    await queue.retry(queue.items()[0].id, { category: 'portraits', collectionId: null });
    expect(queue.items().map(item => item.status)).toEqual(['complete', 'complete']);
    expect(uploadOne).toHaveBeenCalledTimes(3);
  });

  it('cancels only queued items', () => {
    const queue = createUploadQueue({ uploadOne: vi.fn() });
    queue.add([new File(['a'], 'one.png')]);

    queue.cancel(queue.items()[0].id);

    expect(queue.items()[0].status).toBe('cancelled');
  });
});

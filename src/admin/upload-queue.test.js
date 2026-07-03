import { describe, expect, it, vi } from 'vitest';
import { createUploadQueue } from './upload-queue.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

  it('coalesces overlapping runs into one serial drain', async () => {
    const first = deferred();
    let active = 0;
    let maxActive = 0;
    const uploadOne = vi.fn(async file => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (file.name === 'one.png') await first.promise;
        return { photoId: file.name };
      } finally {
        active -= 1;
      }
    });
    const queue = createUploadQueue({ uploadOne });
    queue.add([new File(['a'], 'one.png'), new File(['b'], 'two.png')]);

    const firstRun = queue.run({});
    const overlappingRun = queue.run({});
    await Promise.resolve();

    expect(uploadOne).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all([firstRun, overlappingRun]);
    expect(uploadOne).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('skips a later item cancelled while an earlier upload is active', async () => {
    const first = deferred();
    const uploadOne = vi.fn(file => (
      file.name === 'one.png' ? first.promise : Promise.resolve({ photoId: file.name })
    ));
    const queue = createUploadQueue({ uploadOne });
    queue.add([new File(['a'], 'one.png'), new File(['b'], 'two.png')]);

    const running = queue.run({});
    await Promise.resolve();
    queue.cancel(queue.items()[1].id);
    first.resolve({ photoId: 'one.png' });
    await running;

    expect(uploadOne).toHaveBeenCalledTimes(1);
    expect(queue.items().map(item => item.status)).toEqual(['complete', 'cancelled']);
  });

  it('does not cancel uploading or complete items', async () => {
    const pending = deferred();
    const queue = createUploadQueue({ uploadOne: vi.fn(() => pending.promise) });
    queue.add([new File(['a'], 'one.png')]);
    const id = queue.items()[0].id;

    const running = queue.run({});
    await Promise.resolve();
    queue.cancel(id);
    expect(queue.items()[0].status).toBe('uploading');

    pending.resolve({ photoId: 'one' });
    await running;
    queue.cancel(id);
    expect(queue.items()[0].status).toBe('complete');
  });
});

export function createUploadQueue({ uploadOne }) {
  let state = [];
  let drainPromise = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener(state.map(item => ({ ...item }))));
  const patch = (id, changes) => {
    state = state.map(item => item.id === id ? { ...item, ...changes } : item);
    emit();
  };
  const runItem = async (item, context) => {
    try {
      const result = await uploadOne(item.file, context, message => patch(item.id, { message }));
      patch(item.id, { status: 'complete', result, message: 'Complete' });
    } catch (error) {
      patch(item.id, { status: 'failed', error: error.message, message: 'Failed' });
    }
  };
  const drain = async context => {
    while (true) {
      const queued = state.find(item => item.status === 'queued');
      if (!queued) return;

      const current = state.find(item => item.id === queued.id);
      if (current?.status !== 'queued') continue;

      patch(current.id, { status: 'uploading', error: null });
      await runItem(current, context);
    }
  };
  const run = context => {
    if (!drainPromise) {
      drainPromise = drain(context).finally(() => {
        drainPromise = null;
      });
    }
    return drainPromise;
  };

  return {
    add(files) {
      state.push(...files.map(file => ({
        id: crypto.randomUUID(),
        file,
        status: 'queued',
        message: 'Queued',
        error: null
      })));
      emit();
    },
    run,
    async retry(id, context) {
      const item = state.find(entry => entry.id === id && entry.status === 'failed');
      if (item) {
        patch(id, { status: 'queued', message: 'Queued', error: null });
        await run(context);
      }
    },
    cancel(id) {
      const item = state.find(entry => entry.id === id);
      if (item?.status === 'queued') {
        patch(id, { status: 'cancelled', message: 'Cancelled' });
      }
    },
    items: () => state.map(item => ({ ...item })),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function createUploadQueue({ uploadOne }) {
  let state = [];
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener(state.map(item => ({ ...item }))));
  const patch = (id, changes) => {
    state = state.map(item => item.id === id ? { ...item, ...changes } : item);
    emit();
  };
  const runItem = async (item, context) => {
    if (item.status === 'cancelled') return;
    patch(item.id, { status: 'uploading', error: null });
    try {
      const result = await uploadOne(item.file, context, message => patch(item.id, { message }));
      patch(item.id, { status: 'complete', result, message: 'Complete' });
    } catch (error) {
      patch(item.id, { status: 'failed', error: error.message, message: 'Failed' });
    }
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
    async run(context) {
      for (const item of state.filter(entry => entry.status === 'queued')) {
        await runItem(item, context);
      }
    },
    async retry(id, context) {
      const item = state.find(entry => entry.id === id && entry.status === 'failed');
      if (item) await runItem(item, context);
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

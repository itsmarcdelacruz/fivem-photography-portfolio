let dirty = false;

export function setAdminDirty(value) {
  dirty = Boolean(value);
}

export function isAdminDirty() {
  return dirty;
}

export function confirmAdminNavigation({ clear = true } = {}) {
  if (!dirty) return true;
  if (!globalThis.confirm('Discard unsaved changes?')) return false;
  if (clear) dirty = false;
  return true;
}

export function handleAdminBeforeUnload(event) {
  if (!dirty) return undefined;
  event.preventDefault();
  return '';
}

export function createLightbox(root, { getItems }) {
  let index = 0;
  let trigger = null;
  const image = root.querySelector('[data-lb-image]');
  const title = root.querySelector('[data-lb-title]');
  const meta = root.querySelector('[data-lb-meta]');
  const count = root.querySelector('[data-lb-count]');
  const filmstrip = root.querySelector('[data-lb-filmstrip]');
  const focusable = () => [
    ...root.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])')
  ];
  root.inert = true;

  function render() {
    const items = getItems();
    const item = items[index];
    if (!item) return;
    image.src = item.src;
    image.alt = item.alt || item.title || '';
    title.textContent = item.title || '';
    if (meta) {
      meta.textContent = [item.collection, item.caption, item.meta].filter(Boolean).join(' · ');
    }
    if (count) count.textContent = `${index + 1} / ${items.length}`;
    if (filmstrip) {
      filmstrip.replaceChildren(
        ...items.map((entry, itemIndex) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'lb-thumb';
          button.classList.toggle('active', itemIndex === index);
          button.setAttribute('aria-label', 'View ' + (entry.title || `image ${itemIndex + 1}`));
          const thumb = document.createElement('img');
          thumb.src = entry.thumb || entry.src;
          thumb.alt = '';
          button.appendChild(thumb);
          button.addEventListener('click', () => {
            index = itemIndex;
            render();
          });
          return button;
        })
      );
    }
  }

  function open(nextIndex, nextTrigger) {
    index = nextIndex;
    trigger = nextTrigger || document.activeElement;
    render();
    root.inert = false;
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-active');
    root.querySelector('[data-lb-close]').focus();
  }

  function close() {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
    document.body.classList.remove('lightbox-active');
    trigger?.focus();
  }

  function step(direction) {
    const items = getItems();
    if (!items.length) return;
    index = (index + direction + items.length) % items.length;
    render();
  }

  function onKey(event) {
    if (root.getAttribute('aria-hidden') === 'true') return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
    if (event.key === 'Tab') {
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', onKey);
  root.querySelector('[data-lb-close]').addEventListener('click', close);
  root.querySelector('[data-lb-prev]').addEventListener('click', () => step(-1));
  root.querySelector('[data-lb-next]').addEventListener('click', () => step(1));
  root.addEventListener('click', (event) => {
    if (event.target === root) close();
  });
  return { open, close, step };
}

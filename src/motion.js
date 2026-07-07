export function initGalleryTilt(
  root = document,
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
) {
  const shots = root.querySelectorAll('.shot');
  if (reducedMotion.matches) {
    shots.forEach((figure) => {
      const inner = figure.querySelector('.shot-inner');
      const glare = figure.querySelector('.shot-glare');
      inner.style.transform = '';
      glare.style.removeProperty('--gx');
      glare.style.removeProperty('--gy');
    });
    return;
  }

  const maxTilt = 7;
  shots.forEach((figure) => {
    const inner = figure.querySelector('.shot-inner');
    const glare = figure.querySelector('.shot-glare');
    const slot = figure.querySelector('image-slot');
    figure.addEventListener('pointermove', (event) => {
      if (slot.hasAttribute('data-reframe')) {
        inner.style.transform = '';
        return;
      }
      const bounds = figure.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      const rotateX = (0.5 - y) * maxTilt * 2;
      const rotateY = (x - 0.5) * maxTilt * 2;
      inner.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(8px)`;
      glare.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      glare.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    });
    figure.addEventListener('pointerleave', () => {
      inner.style.transform = '';
    });
  });
}

export function initHeroMotion(
  root = document,
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'),
  requestFrame = requestAnimationFrame
) {
  const layers = [...root.querySelectorAll('.hero [data-depth]')];
  const hero = root.querySelector('.hero');
  if (reducedMotion.matches) {
    layers.forEach((layer) => {
      layer.style.transform = '';
    });
    return;
  }
  if (!hero) return;

  const heroPhoto = root.getElementById('heroPhoto');
  let x = 0;
  let y = 0;
  let targetX = 0;
  let targetY = 0;
  let scrollY = 0;
  hero.addEventListener('pointermove', (event) => {
    const bounds = hero.getBoundingClientRect();
    targetX = (event.clientX - bounds.width / 2) / bounds.width;
    targetY = (event.clientY - bounds.height / 2) / bounds.height;
  });
  hero.addEventListener('pointerleave', () => {
    targetX = 0;
    targetY = 0;
  });
  window.addEventListener(
    'scroll',
    () => {
      scrollY = window.scrollY;
    },
    { passive: true }
  );

  function frame() {
    x += (targetX - x) * 0.06;
    y += (targetY - y) * 0.06;
    layers.forEach((layer) => {
      const depth = parseFloat(layer.dataset.depth) || 0;
      const px = -x * depth * 2.2;
      const py = -y * depth * 2.2;
      if (layer === heroPhoto) {
        layer.style.transform = `translate(-50%,-50%) translate3d(${px}px,${py}px,0) rotateY(${(-x * 9).toFixed(2)}deg) rotateX(${(y * 9).toFixed(2)}deg)`;
      } else if (layer.classList.contains('hero-glow')) {
        layer.style.transform = `translate(-50%,-50%) translate3d(${px}px,${py}px,0)`;
      } else if (layer.classList.contains('hero-word')) {
        layer.style.transform = `translateX(-50%) translate3d(${px}px,${py - scrollY * 0.05}px,0)`;
      } else {
        layer.style.transform = `translate3d(${px}px,${py - scrollY * 0.04}px,0)`;
      }
    });
    requestFrame(frame);
  }
  requestFrame(frame);
}

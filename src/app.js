/* ============================================================
   KATIE MONROE — interactions
   ============================================================ */
import { CATS, loadPortfolio } from './data.js';
import { createLightbox } from './lightbox.js';
import { initGalleryTilt, initHeroMotion } from './motion.js';
import {
  createGalleryFilterController,
  getVisibleFilledShots,
  renderPortfolioError,
  renderStoryHighlights
} from './stories.js';

var portfolioLoadError = null;
var portfolio;
try {
  portfolio = await loadPortfolio();
} catch (error) {
  portfolioLoadError = error;
  portfolio = { shots: [], collections: [] };
}
var SHOTS = portfolio.shots;
var COLLECTIONS = portfolio.collections;
renderStoryHighlights(document.getElementById('stories'), COLLECTIONS);

(function () {
  'use strict';

  var grid = document.getElementById('grid');
  var filterWrap = document.getElementById('filters');
  var collectionFilters = document.getElementById('collectionFilters');

  function makeFilter(label, value, kind, active) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter' + (active ? ' active' : '');
    button.dataset.filterKind = kind;
    button.dataset.filterValue = value;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = label;
    return button;
  }

  /* ---------- build filter chips ---------- */
  CATS.forEach(function (c, i) {
    var count =
      c.id === 'all'
        ? SHOTS.length
        : SHOTS.filter(function (s) {
            return s.cat === c.id;
          }).length;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter' + (i === 0 ? ' active' : '');
    b.dataset.filterKind = 'category';
    b.dataset.filterValue = c.id;
    b.setAttribute('aria-pressed', String(i === 0));
    // count is a zero-padded number string — not user input, safe for innerHTML
    b.innerHTML = c.label + '<span class="n">' + String(count).padStart(2, '0') + '</span>'; // nosec
    filterWrap.appendChild(b);
  });
  collectionFilters.appendChild(makeFilter('All stories', 'all', 'collectionId', true));
  COLLECTIONS.forEach(function (collection) {
    collectionFilters.appendChild(
      makeFilter(collection.title, collection.id, 'collectionId', false)
    );
  });

  /* ---------- build gallery ---------- */
  var EXPAND_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  SHOTS.forEach(function (s, i) {
    var fig = document.createElement('figure');
    fig.className = 'shot';
    fig.dataset.cat = s.cat;
    fig.dataset.idx = i;

    var catLabel =
      (
        CATS.filter(function (c) {
          return c.id === s.cat;
        })[0] || {}
      ).label || s.cat;

    // All live DB values escaped via esc() — EXPAND_SVG is a static constant
    fig.innerHTML =
      '<div class="shot-inner" style="aspect-ratio:' +
      esc(s.ar) +
      '">' +
      '<image-slot id="shot-' +
      i +
      '" shape="rounded" radius="7" ' +
      'src="' +
      esc(s.thumb || '/images/shot-' + i + '.webp') +
      '" alt="' +
      esc(s.alt || s.t) +
      '" placeholder="' +
      esc(catLabel) +
      '"></image-slot>' +
      '<div class="shot-glare"></div>' +
      '<span class="shot-cat">' +
      esc(catLabel) +
      '</span>' +
      '<button class="shot-expand" aria-label="View full screen">' +
      EXPAND_SVG +
      '</button>' +
      '<figcaption class="shot-cap"><div class="t">' +
      esc(s.t) +
      '</div><div class="m">' +
      esc(s.m) +
      '</div></figcaption>' +
      '</div>'; // nosec — EXPAND_SVG is a static constant

    grid.appendChild(fig);

    var slot = fig.querySelector('image-slot');
    var sync = function () {
      fig.toggleAttribute('data-filled', slot.hasAttribute('data-filled'));
    };
    new MutationObserver(sync).observe(slot, {
      attributes: true,
      attributeFilter: ['data-filled']
    });
    sync();
  });

  /* ---------- filters ---------- */
  createGalleryFilterController(document.querySelector('.gallery'), SHOTS, {
    loadError: Boolean(portfolioLoadError)
  });

  if (portfolioLoadError) {
    renderPortfolioError(grid, function () {
      location.reload();
    });
  }

  initGalleryTilt();

  /* ---------- LIGHTBOX ---------- */
  var lb = document.getElementById('lightbox');

  function slotImg(fig) {
    var slot = fig.querySelector('image-slot');
    if (!slot || !slot.shadowRoot) return null;
    var img = slot.shadowRoot.querySelector('img[part="image"]');
    return img && img.src ? img.src : null;
  }

  function visibleFilledShots() {
    return getVisibleFilledShots(document);
  }

  function galleryLightboxItems() {
    return visibleFilledShots().map(function (figure) {
      var shot = SHOTS[Number(figure.dataset.idx)];
      return {
        src: shot.full || slotImg(figure),
        thumb: shot.thumb || slotImg(figure),
        title: shot.t,
        alt: shot.alt || shot.t,
        meta: shot.m,
        collection:
          (
            COLLECTIONS.find(function (collection) {
              return (shot.collection_ids || []).includes(collection.id);
            }) || {}
          ).title || ''
      };
    });
  }
  var lightbox = createLightbox(lb, { getItems: galleryLightboxItems });

  function openLightbox(fig, trigger) {
    var list = visibleFilledShots();
    var index = list.indexOf(fig);
    if (index >= 0 && slotImg(fig)) lightbox.open(index, trigger);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.shot-expand');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openLightbox(btn.closest('.shot'), btn);
      return;
    }
    var fig = e.target.closest('.shot');
    if (fig && fig.hasAttribute('data-filled')) {
      var slot = fig.querySelector('image-slot');
      if (slot && (slot.hasAttribute('data-reframe') || e.target.closest('[data-act]'))) return;
      openLightbox(fig, fig);
    }
  });

  /* ---------- NAV scrolled state ---------- */
  var nav = document.getElementById('nav');
  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  initHeroMotion();

  /* ---------- scroll reveals ---------- */
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  document.querySelectorAll('.reveal').forEach(function (el) {
    io.observe(el);
  });

  var shotObs = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var el = en.target;
          var delay = (parseInt(el.dataset.idx, 10) % 3) * 80;
          el.style.transitionDelay = delay + 'ms';
          el.classList.add('in');
          shotObs.unobserve(el);
        }
      });
    },
    { threshold: 0.08 }
  );
  document.querySelectorAll('.shot').forEach(function (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateY(28px)';
    el.style.transition = 'opacity .7s var(--ease), transform .7s var(--ease)';
    shotObs.observe(el);
  });
})();

/* ============================================================
   COMMISSION FORM
   ============================================================ */
(function () {
  'use strict';
  var form = document.getElementById('commissionForm');
  if (!form) return;

  var chipWrap = document.getElementById('shootTypes');
  var typeInput = document.getElementById('shootTypeInput');
  if (chipWrap) {
    chipWrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.cf-chip');
      if (!chip) return;
      var wasOn = chip.classList.contains('active');
      chipWrap.querySelectorAll('.cf-chip').forEach(function (c) {
        c.classList.remove('active');
      });
      if (!wasOn) {
        chip.classList.add('active');
        typeInput.value = chip.dataset.val;
      } else {
        typeInput.value = '';
      }
    });
  }

  var body = form.querySelector('.cf-body');
  var success = document.getElementById('cfSuccess');
  var btn = form.querySelector('.cf-submit');
  var btnLabel = form.querySelector('.cf-submit-label');

  function val(name) {
    var el = form.elements[name];
    return el ? el.value.trim() : '';
  }

  function showSuccess() {
    if (body) body.hidden = true;
    if (success) success.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (val('_honey')) return;
    if (!form.reportValidity()) return;

    btn.disabled = true;
    btn.classList.add('loading');
    btnLabel.textContent = 'Sending…';

    function fail() {
      btn.disabled = false;
      btn.classList.remove('loading');
      btnLabel.textContent = 'Send the brief';
      alert('Something went wrong. Reach me on Discord: Katiebug515');
    }

    var workerUrl = import.meta.env.VITE_WORKER_URL;
    // No backend configured — don't fake success and silently drop the brief.
    if (!workerUrl) {
      fail();
      return;
    }
    fetch(workerUrl + '/api/commissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: val('Name'),
        shoot_type: val('Shoot type') || null,
        contact: [val('Phone'), val('Email (Discord)')].filter(Boolean).join(' / '),
        deadline: val('Deadline') || null,
        refs: val('References') || null,
        notes: val('Notes') || null
      })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('server error');
        showSuccess();
      })
      .catch(fail);
  });
})();

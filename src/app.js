/* ============================================================
   KATIE MONROE — interactions
   ============================================================ */
import { CATS, SHOTS } from './data.js';

(function () {
  'use strict';

  var grid = document.getElementById('grid');
  var filterWrap = document.getElementById('filters');

  /* ---------- build filter chips ---------- */
  CATS.forEach(function (c, i) {
    var count = c.id === 'all' ? SHOTS.length : SHOTS.filter(function (s) { return s.cat === c.id; }).length;
    var b = document.createElement('button');
    b.className = 'filter' + (i === 0 ? ' active' : '');
    b.dataset.cat = c.id;
    // count is a zero-padded number string — not user input, safe for innerHTML
    b.innerHTML = c.label + '<span class="n">' + String(count).padStart(2, '0') + '</span>'; // nosec
    filterWrap.appendChild(b);
  });

  /* ---------- build gallery ---------- */
  var EXPAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

  SHOTS.forEach(function (s, i) {
    var fig = document.createElement('figure');
    fig.className = 'shot';
    fig.dataset.cat = s.cat;
    fig.dataset.idx = i;

    var catLabel = (CATS.filter(function (c) { return c.id === s.cat; })[0] || {}).label || s.cat;

    // All values (s.ar, i, catLabel, s.t, s.m) are from our own static data.js — not user input
    fig.innerHTML = // nosec
      '<div class="shot-inner" style="aspect-ratio:' + s.ar + '">' +
        '<image-slot id="shot-' + i + '" shape="rounded" radius="7" ' +
          'src="/images/shot-' + i + '.webp" placeholder="' + catLabel + '"></image-slot>' +
        '<div class="shot-glare"></div>' +
        '<span class="shot-cat">' + catLabel + '</span>' +
        '<button class="shot-expand" aria-label="View full screen">' + EXPAND_SVG + '</button>' +
        '<figcaption class="shot-cap"><div class="t">' + s.t + '</div><div class="m">' + s.m + '</div></figcaption>' +
      '</div>';

    grid.appendChild(fig);

    var slot = fig.querySelector('image-slot');
    var sync = function () { fig.toggleAttribute('data-filled', slot.hasAttribute('data-filled')); };
    new MutationObserver(sync).observe(slot, { attributes: true, attributeFilter: ['data-filled'] });
    sync();
  });

  /* ---------- filters ---------- */
  filterWrap.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter');
    if (!btn) return;
    filterWrap.querySelectorAll('.filter').forEach(function (f) { f.classList.remove('active'); });
    btn.classList.add('active');
    var cat = btn.dataset.cat;
    document.querySelectorAll('.shot').forEach(function (fig) {
      var show = cat === 'all' || fig.dataset.cat === cat;
      fig.classList.toggle('hide', !show);
    });
  });

  /* ---------- 3D tilt on cards ---------- */
  var MAX_TILT = 7;
  document.querySelectorAll('.shot').forEach(function (fig) {
    var inner = fig.querySelector('.shot-inner');
    var glare = fig.querySelector('.shot-glare');
    var slot = fig.querySelector('image-slot');

    fig.addEventListener('pointermove', function (e) {
      if (slot.hasAttribute('data-reframe')) { inner.style.transform = ''; return; }
      var r = fig.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;
      var py = (e.clientY - r.top) / r.height;
      var rx = (0.5 - py) * MAX_TILT * 2;
      var ry = (px - 0.5) * MAX_TILT * 2;
      inner.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateZ(8px)';
      glare.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      glare.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
    });
    fig.addEventListener('pointerleave', function () {
      inner.style.transform = '';
    });
  });

  /* ---------- LIGHTBOX ---------- */
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var lbTitle = document.getElementById('lbTitle');
  var lbMeta = document.getElementById('lbMeta');
  var lbCount = document.getElementById('lbCount');
  var current = -1;

  function slotImg(fig) {
    var slot = fig.querySelector('image-slot');
    if (!slot || !slot.shadowRoot) return null;
    var img = slot.shadowRoot.querySelector('img[part="image"]');
    return img && img.src ? img.src : null;
  }

  function visibleFilledShots() {
    return Array.prototype.filter.call(
      document.querySelectorAll('.shot'),
      function (f) { return !f.classList.contains('hide') && f.hasAttribute('data-filled'); }
    );
  }

  function openLightbox(fig) {
    var src = slotImg(fig);
    if (!src) return;
    var i = parseInt(fig.dataset.idx, 10);
    current = i;
    var s = SHOTS[i];
    lbImg.src = src;
    lbTitle.textContent = s.t;
    lbMeta.textContent = s.m;
    var list = visibleFilledShots();
    var pos = list.indexOf(fig) + 1;
    // pos and list.length are numbers — not user input
    lbCount.innerHTML = '<b>' + String(pos).padStart(2, '0') + '</b> / ' + String(list.length).padStart(2, '0'); // nosec
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function step(dir) {
    var list = visibleFilledShots();
    if (!list.length) return;
    var cur = document.querySelector('.shot[data-idx="' + current + '"]');
    var idx = list.indexOf(cur);
    var next = list[(idx + dir + list.length) % list.length];
    if (next) openLightbox(next);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.shot-expand');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openLightbox(btn.closest('.shot'));
      return;
    }
    var fig = e.target.closest('.shot');
    if (fig && fig.hasAttribute('data-filled')) {
      var slot = fig.querySelector('image-slot');
      if (slot && (slot.hasAttribute('data-reframe') || e.target.closest('[data-act]'))) return;
      openLightbox(fig);
    }
  });

  document.getElementById('lbClose').addEventListener('click', closeLightbox);
  document.getElementById('lbPrev').addEventListener('click', function () { step(-1); });
  document.getElementById('lbNext').addEventListener('click', function () { step(1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  /* ---------- NAV scrolled state ---------- */
  var nav = document.getElementById('nav');
  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- HERO parallax (mouse + scroll) ---------- */
  var heroLayers = Array.prototype.slice.call(document.querySelectorAll('.hero [data-depth]'));
  var heroPhoto = document.getElementById('heroPhoto');
  var hero = document.querySelector('.hero');
  var mx = 0, my = 0, tmx = 0, tmy = 0, scrollY = 0;

  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect();
    tmx = (e.clientX - r.width / 2) / r.width;
    tmy = (e.clientY - r.height / 2) / r.height;
  });
  hero.addEventListener('pointerleave', function () { tmx = 0; tmy = 0; });

  function raf() {
    mx += (tmx - mx) * 0.06;
    my += (tmy - my) * 0.06;
    heroLayers.forEach(function (el) {
      var d = parseFloat(el.dataset.depth) || 0;
      var px = -mx * d * 2.2;
      var py = -my * d * 2.2;
      if (el === heroPhoto) {
        el.style.transform = 'translate(-50%,-50%) translate3d(' + px + 'px,' + py + 'px,0) rotateY(' + (-mx * 9).toFixed(2) + 'deg) rotateX(' + (my * 9).toFixed(2) + 'deg)';
      } else if (el.classList.contains('hero-glow')) {
        el.style.transform = 'translate(-50%,-50%) translate3d(' + px + 'px,' + py + 'px,0)';
      } else if (el.classList.contains('hero-word')) {
        el.style.transform = 'translateX(-50%) translate3d(' + px + 'px,' + (py - scrollY * 0.05) + 'px,0)';
      } else {
        el.style.transform = 'translate3d(' + px + 'px,' + (py - scrollY * 0.04) + 'px,0)';
      }
    });
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  window.addEventListener('scroll', function () { scrollY = window.scrollY; }, { passive: true });

  /* ---------- scroll reveals ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  var shotObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        var el = en.target;
        var delay = (parseInt(el.dataset.idx, 10) % 3) * 80;
        el.style.transitionDelay = delay + 'ms';
        el.classList.add('in');
        shotObs.unobserve(el);
      }
    });
  }, { threshold: 0.08 });
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
      chipWrap.querySelectorAll('.cf-chip').forEach(function (c) { c.classList.remove('active'); });
      if (!wasOn) { chip.classList.add('active'); typeInput.value = chip.dataset.val; }
      else { typeInput.value = ''; }
    });
  }

  var body = form.querySelector('.cf-body');
  var success = document.getElementById('cfSuccess');
  var btn = form.querySelector('.cf-submit');
  var btnLabel = form.querySelector('.cf-submit-label');

  function val(name) { var el = form.elements[name]; return el ? el.value.trim() : ''; }

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

    /* Backend not wired up yet — shows success after brief delay.
       Replace this with a real fetch() call in phase 2. */
    setTimeout(function () { showSuccess(); }, 800);
  });
})();

document.addEventListener('DOMContentLoaded', function () {
  var style = document.createElement('style');
  style.textContent = '.shot.in{opacity:1 !important;transform:none !important;}';
  document.head.appendChild(style);
});

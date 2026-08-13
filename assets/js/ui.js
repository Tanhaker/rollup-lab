/* ============================================================================
   ui.js — shared behaviour for all four pages.

   Loaded from <head> and NOT deferred, on purpose. Two things have to happen
   before the first paint:
     · the `js` class lands on <html>, so the reveal animation can hide things
       (without it the site stays fully readable with JavaScript off)
     · the saved theme is applied, so a light-theme visitor doesn't get a dark
       flash on every navigation

   Everything else waits for DOMContentLoaded.

   Responsibilities:
     1. mark the document as JS-capable
     2. apply the saved colour theme before paint, and wire the toggle
     3. mobile navigation
     4. "scrolled" state on the sticky header
     5. scroll-reveal for sections
   ============================================================================ */

(function () {
  'use strict';

  const THEME_KEY = 'rollup-lab:theme';

  document.documentElement.classList.add('js');

  /* ------------------------------------- theme, applied before first paint */

  // Dark is this site's default, not just its dark mode — the whole palette is
  // built around a deep background. A visitor who has never touched the toggle
  // gets dark regardless of their OS setting; light is opt-in and remembered.
  function preferredTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (err) { /* private mode — fall through to the default */ }

    return 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // batcher.js listens for this so the canvas re-reads its palette.
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  // Runs immediately, not on DOMContentLoaded — that is the whole point.
  applyTheme(preferredTheme());

  /* ------------------------------------------------------------ the rest */

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(function () {
    /* ---------- theme toggle ---------- */
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      const sync = function () {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        themeBtn.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
        themeBtn.setAttribute('aria-pressed', String(isLight));
      };
      sync();

      themeBtn.addEventListener('click', function () {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        sync();
        try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* not fatal */ }
      });
    }

    /* ---------- mobile navigation ---------- */
    const toggle = document.querySelector('[data-nav-toggle]');
    const links = document.getElementById('navLinks');

    if (toggle && links) {
      toggle.addEventListener('click', function () {
        const open = links.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
      });

      // Tapping a link closes the menu again
      links.addEventListener('click', function (e) {
        if (e.target.closest('a')) {
          links.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });

      // Escape closes it too, which keyboard users will expect.
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && links.classList.contains('is-open')) {
          links.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });

      // Leaving the mobile breakpoint should never strand the menu in a
      // half-open state, so reset it whenever the query stops matching.
      const mq = window.matchMedia('(max-width: 820px)');
      const reset = function () {
        if (!mq.matches) {
          links.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', reset);
      else if (mq.addListener) mq.addListener(reset);
    }

    /* ---------- sticky header gains a border once the page moves ---------- */
    const nav = document.querySelector('.nav');
    if (nav) {
      const setScrolled = function () {
        nav.classList.toggle('is-scrolled', window.scrollY > 8);
      };
      setScrolled();
      window.addEventListener('scroll', setScrolled, { passive: true });
    }

    /* ---------- scroll reveal ---------- */
    const targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;

    // No IntersectionObserver (or reduced motion) → show everything immediately.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);   // reveal once, then stop watching
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    // A small stagger so a grid of cards arrives in sequence rather than
    // all at once, which reads as deliberate instead of janky.
    targets.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 60 + 'ms';
      observer.observe(el);
    });
  });
})();

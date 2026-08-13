/* ============================================================
   ui.js — shared behaviour for all four pages.

   Loaded from <head> (not deferred) so the `js` class lands on <html>
   before first paint. Without that class the reveal animation never
   hides anything, which keeps the site fully readable with JS off.

   Responsibilities:
     1. mark the document as JS-capable
     2. mobile navigation toggle
     3. "scrolled" state on the sticky header
     4. scroll-reveal for sections
   ============================================================ */

(function () {
  document.documentElement.classList.add('js');

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(function () {
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

      // Leaving the mobile breakpoint should never strand the menu in a
      // half-open state, so reset it whenever the query stops matching.
      const mq = window.matchMedia('(max-width: 680px)');
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

    targets.forEach(function (el) { observer.observe(el); });
  });
})();

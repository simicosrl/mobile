import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { defineCustomElements } from '@ionic/pwa-elements/loader'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// If this script runs at all, clear the plain pre-React fallback wired up
// in index.html (see the inline script there for what happens if it never
// gets this far).
window.__appBooted = true;

// @capacitor/camera's web fallback (used if this ever runs as a plain web
// build, and by the browser-preview dev server) needs these custom elements
// registered for its action-sheet/camera-modal UI. The native Android path
// doesn't need this — it shows its own native action sheet.
defineCustomElements(window);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Every field this session hit "blank screen while the keyboard is up" on
// (Scan's manual entry, Signature's driver fields, the no-code/damage note
// fields) shares one thing: it lives inside App.jsx's Shell in a scrollable
// <div class="overflow-y-auto"> nested inside a <div class="overflow-hidden">
// — and the app never resizes that layout for the keyboard (index.html was
// reverted back to the default 'resizes-visual' behavior, on purpose, so
// the bottom nav stays hidden under the keyboard instead of popping up
// above it). That leaves the browser's own built-in "scroll the focused
// field into view" heuristic as the only thing responsible for making sure
// a focused input ends up visible above the keyboard — and on this old a
// WebView (Android 10, last patched 2021), that heuristic is exactly the
// kind of thing known to misjudge a *nested* scrollable container (as
// opposed to the page itself) and land on the wrong scroll offset, which
// would look exactly like this: the header (never scrolled) stays correct,
// the scrollable content area lands on blank space instead of the field,
// and it all works again once the input blurs (which resets/re-triggers
// scroll). This does the "scroll the focused field into view" job
// ourselves, using window.visualViewport (which reports the actually
// visible area above the keyboard) instead of trusting that heuristic.
(function () {
  function scrollFocusedIntoView() {
    var el = document.activeElement;
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    var vv = window.visualViewport;
    if (!vv) return;
    var scroller = el.closest('.overflow-y-auto');
    if (!scroller) return;
    // The field has to end up inside the part of its own scroll container
    // that is actually on screen — which is the container's box clipped by
    // the area the keyboard leaves. Clamping against the window alone isn't
    // enough: the container starts below the header, so a field scrolled to
    // the very top gets its top edge cut off by the container's own top
    // edge, leaving just a sliver of it visible.
    // getBoundingClientRect() is relative to the layout viewport's origin, so
    // vv.offsetTop (the visual viewport's offset from that same origin) is
    // what it compares against — not vv.pageTop, which counts page scroll too.
    var box = scroller.getBoundingClientRect();
    var top = Math.max(box.top, vv.offsetTop);
    var bottom = Math.min(box.bottom, vv.offsetTop + vv.height);
    if (bottom - top < 40) return;
    var rect = el.getBoundingClientRect();
    // Breathing room above/below the field, but never more than the space
    // left over once the field itself is placed — on a short strip between
    // the header and the keyboard a fixed margin would push it back out.
    var margin = Math.max(0, Math.min(16, (bottom - top - rect.height) / 2));
    if (rect.bottom > bottom - margin) {
      scroller.scrollTop += rect.bottom - (bottom - margin);
    } else if (rect.top < top + margin) {
      scroller.scrollTop -= top + margin - rect.top;
    }
  }
  // A single shot at a fixed delay is really a guess about how long this
  // particular device takes to animate the keyboard in and settle the new
  // layout — and on a slow old phone that guess lands before the layout is
  // final, so it corrects against numbers that are about to change. Re-running
  // it across the whole window a keyboard can take costs nothing (it's a
  // no-op as soon as the field already fits) and removes the timing guess.
  function scheduleScroll() {
    [60, 180, 350, 550, 800].forEach(function (d) {
      setTimeout(scrollFocusedIntoView, d);
    });
  }
  document.addEventListener(
    'focusin',
    function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        scheduleScroll();
      }
    },
    true
  );
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleScroll);
  }
})();

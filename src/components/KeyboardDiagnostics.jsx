import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

// The keyboard behaves differently on the warehouse phones than it does in any
// browser we can test against here (an Android 10 WebView last patched in
// 2021), and the difference is the whole problem: whether the window actually
// shrinks for the keyboard decides whether a focused field can ever be
// scrolled clear of it. This panel reports what really happens on the device —
// tap the field below, then photograph the numbers with the keyboard open.
export default function KeyboardDiagnostics() {
  const inputRef = useRef(null);
  const [snap, setSnap] = useState(null);
  const [frozen, setFrozen] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    // Whether the window resizes for the keyboard can't be seen by comparing
    // the window to the visual viewport — under adjustResize they shrink
    // together and stay equal. It only shows against how tall things were
    // before the keyboard came up, so keep the tallest values seen.
    let winMax = window.innerHeight;
    let vvMax = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const read = () => {
      const vv = window.visualViewport;
      const el = document.activeElement;
      const scroller = el && el.closest ? el.closest('.overflow-y-auto') : null;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const b = scroller ? scroller.getBoundingClientRect() : null;
      if (window.innerHeight > winMax) winMax = window.innerHeight;
      if (vv && vv.height > vvMax) vvMax = vv.height;
      setSnap({
        win: Math.round(window.innerHeight),
        winMax: Math.round(winMax),
        winShrankBy: Math.round(winMax - window.innerHeight),
        vvH: vv ? Math.round(vv.height) : null,
        vvShrankBy: vv ? Math.round(vvMax - vv.height) : null,
        vvTop: vv ? Math.round(vv.offsetTop) : null,
        scrollerTop: b ? Math.round(b.top) : null,
        scrollerBottom: b ? Math.round(b.bottom) : null,
        slack: scroller ? Math.round(scroller.scrollHeight - scroller.clientHeight) : null,
        scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
        fieldTop: r ? Math.round(r.top) : null,
        fieldBottom: r ? Math.round(r.bottom) : null,
        focusedIsProbe: el === inputRef.current,
      });
    };
    read();
    const t = setInterval(read, 250);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', read);
    window.addEventListener('resize', read);

    const handles = [];
    let cancelled = false;
    const log = (line) => setEvents((e) => [line, ...e].slice(0, 6));
    const track = (p) => p.then((h) => { if (cancelled) h.remove(); else handles.push(h); }).catch(() => {});
    if (Capacitor.isNativePlatform()) {
      track(Keyboard.addListener('keyboardWillShow', (info) => log('willShow h=' + Math.round(info?.keyboardHeight ?? -1))));
      track(
        Keyboard.addListener('keyboardDidShow', (info) => {
          log('didShow h=' + Math.round(info?.keyboardHeight ?? -1));
          // Freeze the numbers as they are with the keyboard actually up.
          // Read live they're useless: by the time the panel can be
          // photographed the keyboard is usually down again and everything
          // has snapped back to its resting values.
          setTimeout(() => {
            const vv2 = window.visualViewport;
            const el2 = document.activeElement;
            const sc2 = el2 && el2.closest ? el2.closest('.overflow-y-auto') : null;
            const r2 = el2 && el2.getBoundingClientRect ? el2.getBoundingClientRect() : null;
            const b2 = sc2 ? sc2.getBoundingClientRect() : null;
            setFrozen({
              kbH: Math.round(info?.keyboardHeight ?? -1),
              win: Math.round(window.innerHeight),
              winMax: Math.round(winMax),
              vvH: vv2 ? Math.round(vv2.height) : null,
              scrollerTop: b2 ? Math.round(b2.top) : null,
              scrollerBottom: b2 ? Math.round(b2.bottom) : null,
              slack: sc2 ? Math.round(sc2.scrollHeight - sc2.clientHeight) : null,
              fieldTop: r2 ? Math.round(r2.top) : null,
              fieldBottom: r2 ? Math.round(r2.bottom) : null,
            });
          }, 400);
        })
      );
      track(Keyboard.addListener('keyboardWillHide', () => log('willHide')));
    } else {
      log('web preview — no native keyboard events');
    }
    return () => {
      cancelled = true;
      clearInterval(t);
      handles.forEach((h) => h.remove());
      vv?.removeEventListener('resize', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  const row = (k, v) => (
    <div className="flex items-baseline justify-between gap-2 border-b border-[rgba(148,163,184,.15)] py-[3px] last:border-b-0">
      <span className="text-[11px] text-secondary">{k}</span>
      <span className="font-mono text-[12px] font-bold text-ink">{v === null || v === undefined ? '—' : String(v)}</span>
    </div>
  );

  const resizes = snap ? (snap.winShrankBy > 80 || snap.vvShrankBy > 80 ? 'YES' : 'NO') : '—';

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11.5px] leading-[1.5] text-secondary">
        Tap the field, then photograph this panel <b>while the keyboard is open</b>.
      </div>
      {/* Readout above the field on purpose: the field gets scrolled to just
          above the keyboard, so anything below it would be the part the
          keyboard covers — exactly the numbers we need to be able to read. */}
      <div className="rounded-xl border border-[rgba(148,163,184,.25)] bg-white px-3 py-1.5">
        {row('RESIZES FOR KEYBOARD?', resizes)}
        {row('window height', snap ? snap.win + ' (was ' + snap.winMax + ')' : null)}
        {row('window shrank by', snap?.winShrankBy)}
        {row('visual viewport h', snap?.vvH)}
        {row('viewport shrank by', snap?.vvShrankBy)}
        {row('viewport offset top', snap?.vvTop)}
        {row('scroll area top', snap?.scrollerTop)}
        {row('scroll area bottom', snap?.scrollerBottom)}
        {row('scrollable slack', snap?.slack)}
        {row('scrollTop', snap?.scrollTop)}
        {row('field top', snap?.fieldTop)}
        {row('field bottom', snap?.fieldBottom)}
        {row('focus on this field', snap?.focusedIsProbe ? 'yes' : 'no')}
      </div>
      <div className="rounded-xl border border-[rgba(148,163,184,.25)] bg-page px-3 py-2">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-light">Keyboard events</div>
        {events.length === 0 ? (
          <div className="text-[11px] text-secondary">none yet</div>
        ) : (
          events.map((e, i) => (
            <div key={i} className="font-mono text-[11px] text-ink">{e}</div>
          ))
        )}
      </div>
      <input
        ref={inputRef}
        placeholder="Tap here to open the keyboard"
        className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-sm text-ink"
      />
      {frozen && (
        <div className="rounded-xl border-2 border-primary bg-white px-3 py-1.5">
          <div className="py-1 text-[10px] font-bold uppercase tracking-[.08em] text-primary">
            Frozen while the keyboard was open
          </div>
          {row('keyboard height', frozen.kbH)}
          {row('window height', frozen.win + ' (was ' + frozen.winMax + ')')}
          {row('visual viewport h', frozen.vvH)}
          {row('scroll area', frozen.scrollerTop + ' .. ' + frozen.scrollerBottom)}
          {row('scrollable slack', frozen.slack)}
          {row('field', frozen.fieldTop + ' .. ' + frozen.fieldBottom)}
          {row('field clear of kbd?', frozen.fieldBottom !== null && frozen.scrollerBottom !== null && frozen.fieldBottom <= frozen.scrollerBottom ? 'YES' : 'NO')}
        </div>
      )}
    </div>
  );
}

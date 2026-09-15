import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { scanSquare } from '../lib/scanRegion';

// The viewfinder drawn over the live camera. The square here is the same one
// useBarcodeScanner judges hits against — both come from scanSquare() — so the
// frame is a promise the app keeps rather than decoration: a code outside it
// is not accepted, however clearly the camera can see it.
export default function CameraScanOverlay({ onCancel }) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  const sq = scanSquare(size.w, size.h);
  const dim = 'rgba(15,23,42,.62)';

  return createPortal(
    <div className="scan-overlay fixed inset-0 z-[9999] select-none">
      {/* Four panels rather than one box with a hole: keeps the square itself
          completely clear of anything that could confuse the camera. */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: sq.top, background: dim }} />
      <div style={{ position: 'absolute', left: 0, top: sq.top + sq.height, width: '100%', bottom: 0, background: dim }} />
      <div style={{ position: 'absolute', left: 0, top: sq.top, width: sq.left, height: sq.height, background: dim }} />
      <div style={{ position: 'absolute', left: sq.left + sq.width, top: sq.top, right: 0, height: sq.height, background: dim }} />

      <div
        style={{ position: 'absolute', left: sq.left, top: sq.top, width: sq.width, height: sq.height }}
        className="rounded-[18px] border-2 border-white/90 shadow-[0_0_0_2px_rgba(31,111,235,.55)]"
      />

      <div
        style={{ position: 'absolute', left: 0, right: 0, top: Math.max(8, sq.top - 46) }}
        className="px-6 text-center text-[13px] font-bold text-white drop-shadow"
      >
        Hold the code inside the square
      </div>
      <div
        style={{ position: 'absolute', left: 0, right: 0, top: sq.top + sq.height + 14 }}
        className="px-8 text-center text-[11.5px] leading-[1.5] text-white/75"
      >
        Only a code inside the square is read — others nearby are ignored.
      </div>

      <button
        onClick={onCancel}
        className="absolute bottom-10 left-1/2 min-h-[52px] w-[170px] -translate-x-1/2 rounded-xl bg-white text-[15px] font-extrabold text-ink"
      >
        Cancel
      </button>
    </div>,
    document.body
  );
}

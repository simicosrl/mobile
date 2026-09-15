import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const HEIGHT = 180;

const SignaturePad = forwardRef(function SignaturePad({ onChange, hasInk }, ref) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingRef = useRef(false);

  // Assigning canvas.width/height wipes the bitmap — that is literally how you
  // clear a canvas — and this used to run on every window resize. On Android
  // the keyboard opening IS a resize (the window drops from 648 to ~369), so
  // a driver who signed before the operator typed the name or plate watched
  // the signature vanish the moment the keyboard came up. Once signed, it has
  // to survive until the handover is confirmed.
  const setupCanvas = (preserveInk = true) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth;
    if (!width) return;
    const dpr = window.devicePixelRatio || 1;
    const nextW = Math.round(width * dpr);
    const nextH = Math.round(HEIGHT * dpr);

    // Only the width can actually change here (the height is fixed), so a
    // keyboard-driven resize leaves the canvas completely untouched rather
    // than being rebuilt for nothing.
    if (preserveInk && canvas.width === nextW && canvas.height === nextH) return;

    // A real width change (rotation) still has to rebuild the bitmap, so carry
    // whatever is drawn across it instead of throwing it away.
    let previous = null;
    if (preserveInk && canvas.width > 0 && canvas.height > 0) {
      try { previous = canvas.toDataURL('image/png'); } catch { /* ignore */ }
    }

    canvas.width = nextW;
    canvas.height = nextH;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, HEIGHT);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    ctxRef.current = ctx;

    if (previous) {
      const img = new Image();
      img.onload = () => {
        try { ctx.drawImage(img, 0, 0, width, HEIGHT); } catch { /* ignore */ }
      };
      img.src = previous;
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      // The only path that is meant to destroy ink.
      setupCanvas(false);
      onChange(null, false);
    },
  }));

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e) => {
    if (!ctxRef.current) setupCanvas();
    drawingRef.current = true;
    const p = point(e);
    ctxRef.current.beginPath();
    ctxRef.current.moveTo(p.x, p.y);
    if (!hasInk) onChange(null, true);
  };
  const move = (e) => {
    if (!drawingRef.current || !ctxRef.current) return;
    const p = point(e);
    ctxRef.current.lineTo(p.x, p.y);
    ctxRef.current.stroke();
  };
  const up = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      onChange(canvasRef.current.toDataURL('image/png'), true);
    } catch {
      /* ignore */
    }
  };

  return (
    <div ref={wrapRef} className="relative rounded-[14px] border-2 border-dashed border-[rgba(148,163,184,.5)] bg-white p-1.5">
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="block w-full rounded-[9px]"
        style={{ height: HEIGHT, touchAction: 'none' }}
      />
      {!hasInk && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[11px] text-light">
          sign inside the box
        </div>
      )}
    </div>
  );
});

export default SignaturePad;

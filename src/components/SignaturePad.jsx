import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SignaturePad = forwardRef(function SignaturePad({ onChange, hasInk }, ref) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawingRef = useRef(false);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    canvas.width = width * dpr;
    canvas.height = 180 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, 180);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
    ctxRef.current = ctx;
  };

  useEffect(() => {
    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    clear: () => {
      setupCanvas();
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
        style={{ height: 180, touchAction: 'none' }}
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

import { useCallback, useEffect, useRef, useState } from 'react';

// Camera-based fallback scanning for phones/tablets with no hardware
// scan engine or Bluetooth ring scanner attached. Uses the native
// BarcodeDetector API (shipped in Chrome/Android WebView) — no extra
// dependency, no bundled barcode library. When it isn't available the
// caller should fall back to manual entry (see components/ScanField.jsx).
export function isBarcodeDetectionSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function useBarcodeScanner(onDetect) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!isBarcodeDetectionSupported()) {
      setError('Camera scanning is not supported on this device — enter the code manually.');
      return;
    }
    try {
      if (!detectorRef.current) {
        const formats = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'itf', 'data_matrix'];
        // eslint-disable-next-line no-undef
        detectorRef.current = new window.BarcodeDetector({ formats });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      const tick = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          if (codes && codes.length) {
            onDetect(codes[0].rawValue);
            stop();
            return;
          }
        } catch {
          /* transient decode error — keep scanning */
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(err?.message || 'Could not access the camera');
    }
  }, [onDetect, stop]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, active, error, start, stop };
}

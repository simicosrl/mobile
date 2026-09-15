import { useCallback, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner, BarcodeFormat, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { scanSquare, pickAimedBarcode } from '../lib/scanRegion';

// Camera-based fallback scanning for phones with no hardware scan engine.
//
// This used to call the plugin's ready-made scan() UI — Google's own
// full-screen scanner. Convenient, but it draws a frame while accepting a code
// from anywhere in the camera's view, so a shelf of labels behind the parcel
// could be read instead of the one being aimed at. scan() also returns no
// position data at all (the plugin's own docs: cornerPoints "is currently only
// supported by the startScan(...) method"), so there was nothing to filter on.
//
// So: run the camera ourselves via startScan, draw our own square, and accept
// only a code whose centre falls inside it.
const FORMATS = [
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Code93,
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.QrCode,
  BarcodeFormat.Itf,
  BarcodeFormat.DataMatrix,
];

export function isCameraScanSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// startScan puts the camera behind the WebView, so the page has to actually be
// see-through while it runs — otherwise the operator stares at the app instead
// of the camera.
function setTransparent(on) {
  document.body.classList.toggle('scanner-active', on);
}

// The back button and screen teardown both need to be able to stop a scan that
// is already running, from outside this hook.
let activeCancel = null;
export function cancelActiveCameraScan() {
  if (!activeCancel) return false;
  activeCancel();
  return true;
}

export function useBarcodeScanner() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const listenerRef = useRef(null);

  const teardown = useCallback(async () => {
    activeCancel = null;
    try { await listenerRef.current?.remove(); } catch { /* ignore */ }
    listenerRef.current = null;
    try { await BarcodeScanner.stopScan(); } catch { /* ignore */ }
    setTransparent(false);
    setScanning(false);
  }, []);

  const scan = useCallback(async () => {
    if (!isCameraScanSupported()) {
      setError('Camera scanning is only available in the installed app, not this preview.');
      return null;
    }
    setError(null);

    try {
      const permission = await BarcodeScanner.requestPermissions();
      if (permission.camera !== 'granted' && permission.camera !== 'limited') {
        setError('Camera permission is needed to scan.');
        return null;
      }
    } catch {
      setError('Could not ask for camera permission.');
      return null;
    }

    setScanning(true);
    setTransparent(true);

    return new Promise((resolve) => {
      let settled = false;
      const finish = async (value) => {
        if (settled) return;
        settled = true;
        await teardown();
        resolve(value);
      };
      activeCancel = () => finish(null);

      BarcodeScanner.addListener('barcodesScanned', (event) => {
        // Re-read the square every time: the operator may have rotated the
        // phone since the scan started.
        const square = scanSquare(window.innerWidth, window.innerHeight);
        const aimed = pickAimedBarcode(event?.barcodes, square, window.devicePixelRatio || 1);
        if (aimed) finish(aimed);
      })
        .then((handle) => {
          listenerRef.current = handle;
          if (settled) handle.remove().catch(() => {});
          return BarcodeScanner.startScan({ formats: FORMATS, lensFacing: LensFacing.Back });
        })
        .catch((err) => {
          setError(err?.message || 'Could not open the camera scanner');
          finish(null);
        });
    });
  }, [teardown]);

  return { scan, scanning, error, cancel: () => cancelActiveCameraScan() };
}

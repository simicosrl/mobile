import { useCallback, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

// Camera-based fallback scanning for phones/tablets with no hardware scan
// engine or Bluetooth ring scanner attached. Uses the native ML Kit barcode
// scanner plugin's ready-made scan() UI (Google's own full-screen scanner —
// no camera permission prompt needed on Android, no custom overlay to
// build) rather than the web BarcodeDetector/getUserMedia APIs, which are
// unreliable specifically inside an Android WebView (they work in a real
// browser tab but the camera commonly never opens in an embedded WebView
// without extra native permission-bridging that a default Capacitor
// activity doesn't provide).
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

export function useBarcodeScanner() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const scan = useCallback(async () => {
    if (!isCameraScanSupported()) {
      setError('Camera scanning is only available in the installed app, not this preview.');
      return null;
    }
    setError(null);
    setScanning(true);
    try {
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) {
        await BarcodeScanner.installGoogleBarcodeScannerModule();
      }
      const result = await BarcodeScanner.scan({ formats: FORMATS });
      const hit = result.barcodes && result.barcodes[0];
      if (!hit) return null;
      return hit.rawValue || hit.displayValue || null;
    } catch (err) {
      setError(err?.message || 'Could not open the camera scanner');
      return null;
    } finally {
      setScanning(false);
    }
  }, []);

  return { scan, scanning, error };
}

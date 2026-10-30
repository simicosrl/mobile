import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

// Keeps the on-screen keyboard down while the hidden scanner field has focus,
// by closing it only when it actually opens. This used to be a Keyboard.hide()
// every 400ms: harmless on a Zebra (DataWedge writes straight into the field),
// but scanners that type through the phone's input method (Arrvel F2) lost a
// scan whenever the trigger was pulled during one of those calls — the scanner
// beeped its own "nowhere to write" error and nothing reached the app.
export function useKeepKeyboardDown(fieldRef, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return undefined;
    const hideIfScanField = () => {
      if (document.activeElement === fieldRef.current) Keyboard.hide().catch(() => {});
    };
    hideIfScanField();
    const handle = Keyboard.addListener('keyboardDidShow', hideIfScanField);
    return () => { Promise.resolve(handle).then((h) => h.remove()).catch(() => {}); };
  }, [enabled, fieldRef]);
}

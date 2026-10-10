import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { isCameraScanSupported } from './useBarcodeScanner';

// The hardware-scanner field the Scan screen uses, as a hook for the receiving
// screens: an always-focused input a Zebra / ring scanner types into, with the
// on-screen keyboard kept down unless the operator asks for it. Same rules as
// Scan.jsx (see the comments there for why each one exists):
//   - never steal focus from another field being typed in;
//   - submit on Enter, or 400ms after a scanner burst with no terminator;
//   - manual typing submits only on Enter.
export function useScanInput(onCode, { paused = false } = {}) {
  const ref = useRef(null);
  const [buffer, setBuffer] = useState('');
  const [manual, setManual] = useState(false);
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  useEffect(() => {
    if (paused) return undefined;
    const refocus = () => {
      const active = document.activeElement;
      const typingElsewhere =
        active && active !== ref.current &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (typingElsewhere) return;
      if (ref.current && active !== ref.current) {
        try { ref.current.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
      if (!manual && Capacitor.isNativePlatform()) Keyboard.hide().catch(() => {});
    };
    refocus();
    const t = setInterval(refocus, 400);
    return () => clearInterval(t);
  }, [paused, manual]);

  const submit = (value) => {
    const code = String(value || '').trim();
    setBuffer('');
    if (code) onCodeRef.current(code);
  };

  useEffect(() => {
    if (!buffer || manual) return undefined;
    const t = setTimeout(() => submit(buffer), 400);
    return () => clearTimeout(t);
  }, [buffer, manual]);

  const openManual = () => {
    setManual(true);
    ref.current?.focus();
    if (Capacitor.isNativePlatform()) Keyboard.show().catch(() => {});
  };

  const showInput = manual || !isCameraScanSupported();

  return {
    showInput,
    openManual,
    inputProps: {
      ref,
      value: buffer,
      onChange: (e) => setBuffer(e.target.value),
      onKeyDown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        submit(buffer);
      },
      onBlur: () => setManual(false),
      inputMode: showInput ? 'text' : 'none',
      'aria-hidden': !showInput,
      autoCapitalize: 'characters',
      autoCorrect: 'off',
      spellCheck: false,
    },
  };
}

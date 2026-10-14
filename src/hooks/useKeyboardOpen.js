import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

// Whether the on-screen keyboard is open. On the phone the Keyboard plugin
// says so directly; a Zebra scanning into a focused field never raises it, so
// focus alone is not a signal. In a browser, a viewport that suddenly lost a
// big slice of its height is the keyboard.
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handles = [
        Keyboard.addListener('keyboardWillShow', () => setOpen(true)),
        Keyboard.addListener('keyboardDidShow', () => setOpen(true)),
        Keyboard.addListener('keyboardWillHide', () => setOpen(false)),
        Keyboard.addListener('keyboardDidHide', () => setOpen(false)),
      ];
      return () => handles.forEach((h) => Promise.resolve(h).then((x) => x.remove()).catch(() => {}));
    }
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let full = vv.height;
    const onResize = () => {
      full = Math.max(full, vv.height);
      setOpen(full - vv.height > 150);
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return open;
}

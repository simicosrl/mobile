import { useEffect, useRef } from 'react';
import { subscribeScan } from '../lib/hardwareScanner';

// Receives broadcast laser scans while `enabled` (see lib/hardwareScanner.js).
export function useHardwareScan(onCode, enabled = true) {
  const ref = useRef(onCode);
  useEffect(() => { ref.current = onCode; }, [onCode]);
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeScan((code) => ref.current(code));
  }, [enabled]);
}

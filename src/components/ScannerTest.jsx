import { useEffect, useRef, useState } from 'react';
import { lastBroadcast, onBroadcast } from '../lib/hardwareScanner';

// Shows how this phone's laser scanner delivers a scan: typed into a field
// (keyboard output, e.g. Zebra DataWedge) or sent as a broadcast (Arrvel,
// Urovo…), and with which action and extras — what is needed to set up a new
// scanner model.
export default function ScannerTest() {
  const [typed, setTyped] = useState('');
  const [broadcast, setBroadcast] = useState(lastBroadcast());
  const ref = useRef(null);
  useEffect(() => onBroadcast(setBroadcast), []);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] leading-snug text-secondary">
        Tap the field, then scan any barcode with the laser.
      </div>
      <input
        ref={ref}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        placeholder="Tap here, then scan"
        className="min-h-[44px] w-full rounded-xl border border-inputborder bg-page px-3 font-mono text-[13px] text-ink"
      />
      <div className="rounded-xl border border-[rgba(148,163,184,.25)] bg-page px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">
        <div>Typed: {typed ? <b>{typed}</b> : <span className="text-light">nothing yet</span>}</div>
        <div>
          Broadcast: {broadcast
            ? <><b>{broadcast.code || '(no code found)'}</b><br />action {broadcast.action}<br />extras {broadcast.keys}</>
            : <span className="text-light">nothing yet</span>}
        </div>
      </div>
      {typed && <button onClick={() => { setTyped(''); ref.current?.focus(); }} className="self-start text-[12px] font-bold text-primary underline">Clear</button>}
    </div>
  );
}

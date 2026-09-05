import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { docNumber } from '../lib/format';
import SignaturePad from '../components/SignaturePad';
import { ArrowRight } from '../components/icons';

export default function Signature() {
  const app = useApp();
  const {
    direction, carrier, courierCompany, setCourierCompany, plate, setPlate,
    courierName, setCourierName, parcels, docSeq,
    sigInk, setSignatureDataUrl, setSigInk, clearSignature, signReady, finish,
    driverProfiles, applyDriverProfile,
  } = app;
  const isOut = direction === 'out';
  const nextDoc = docNumber(direction, docSeq[direction]);
  const boxes = parcels.reduce((a, p) => a + p.boxes, 0);
  const padRef = useRef(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameMatches = useMemo(() => {
    const q = courierName.trim().toLowerCase();
    const list = q ? driverProfiles.filter((p) => p.name.toLowerCase().includes(q)) : driverProfiles;
    return list.slice(0, 5);
  }, [courierName, driverProfiles]);

  const onSigChange = (dataUrl, hasInk) => {
    setSignatureDataUrl(dataUrl);
    setSigInk(hasInk);
  };

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-3.5">
      <div className="rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white p-[12px_13px]">
        <div className="flex items-center gap-2">
          <div className="rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.1em] text-white" style={{ background: isOut ? '#FF7A00' : '#1F6FEB' }}>
            {isOut ? 'Outbound' : 'Inbound'}
          </div>
          <div className="font-mono text-[11px] text-secondary">{nextDoc}</div>
        </div>
        <div className="mt-2 text-sm font-bold">{parcels.length} parcels / {boxes} boxes · {carrier}</div>
      </div>

      <div className="relative">
        <div className="mb-[7px] text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Driver name</div>
        <input
          value={courierName}
          onChange={(e) => setCourierName(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Full name, printed"
          className="min-h-[50px] w-full rounded-xl border border-inputborder bg-page px-4 text-[15px] text-ink"
        />
        {showSuggestions && nameMatches.length > 0 && (
          <div className="absolute left-0 right-0 top-[74px] z-10 max-h-[190px] overflow-y-auto rounded-xl border border-[rgba(148,163,184,.35)] bg-white shadow-card">
            {nameMatches.map((p) => (
              <button
                key={p.name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { applyDriverProfile(p); setShowSuggestions(false); }}
                className="flex w-full items-center justify-between gap-2 border-b border-[rgba(148,163,184,.15)] px-4 py-2.5 text-left last:border-b-0"
              >
                <span className="min-w-0 truncate text-[13.5px] font-bold text-ink">{p.name}</span>
                <span className="flex-none font-mono text-[11px] text-secondary">{p.plate || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2.5">
        <div className="flex-1">
          <div className="mb-[7px] text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Company</div>
          <input
            value={courierCompany}
            onChange={(e) => setCourierCompany(e.target.value)}
            placeholder="Carrier company"
            className="min-h-[50px] w-full rounded-xl border border-inputborder bg-page px-3 text-[13px] text-ink"
          />
        </div>
        <div className="w-[118px] flex-none">
          <div className="mb-[7px] text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Plate</div>
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="BG 123 XY"
            className="min-h-[50px] w-full rounded-xl border border-inputborder bg-page px-3 font-mono text-[13px] uppercase text-ink"
          />
        </div>
      </div>

      <div>
        <div className="mb-[7px] flex items-center gap-2">
          <div className="text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Signature</div>
          <button onClick={() => { padRef.current?.clear(); clearSignature(); }} className="ml-auto p-1 text-[11px] font-bold text-primary">
            Clear
          </button>
        </div>
        <SignaturePad ref={padRef} onChange={onSigChange} hasInk={sigInk} />
      </div>

      <button
        onClick={finish}
        className={'flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-xl text-[15px] font-extrabold text-white ' + (signReady ? 'cursor-pointer bg-primary' : 'cursor-not-allowed bg-disabled')}
      >
        Confirm handover <ArrowRight size={17} strokeWidth={2.2} />
      </button>
    </div>
  );
}

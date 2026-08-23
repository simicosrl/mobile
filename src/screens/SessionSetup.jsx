import { useApp } from '../state/AppContext';
import { CARRIERS } from '../lib/carriers';
import { docNumber } from '../lib/format';
import { ArrowRight } from '../components/icons';

export default function SessionSetup() {
  const app = useApp();
  const { direction, carrier, setCarrier, courierCompany, setCourierCompany, shipment, setShipment, toScan } = app;
  const isOut = direction === 'out';
  const nextDoc = docNumber(direction, app.docSeq?.[direction] ?? (isOut ? 241 : 240));

  return (
    <div className="flex flex-col gap-4 px-3.5 pb-[22px] pt-4">
      <div className="flex items-center gap-2 rounded-xl border border-[rgba(148,163,184,.25)] bg-white px-3 py-2.5">
        <div
          className="rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.1em] text-white"
          style={{ background: isOut ? '#FF7A00' : '#1F6FEB' }}
        >
          {isOut ? 'Outbound' : 'Inbound'}
        </div>
        <div className="text-xs text-secondary">New session · {nextDoc}</div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Courier</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))' }}>
          {CARRIERS.map((c) => (
            <button
              key={c}
              onClick={() => setCarrier(c)}
              className={
                'min-h-[46px] rounded-[11px] border text-[12.5px] font-bold ' +
                (carrier === c ? 'border-primary bg-[rgba(31,111,235,.08)] text-primary' : 'border-[rgba(148,163,184,.35)] bg-white text-ink')
              }
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Driver company / notes</div>
        <input
          value={courierCompany}
          onChange={(e) => setCourierCompany(e.target.value)}
          placeholder="e.g. DHL Express Italy s.r.l."
          className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-sm text-ink"
        />
      </div>

      {isOut && (
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Destination / shipment ID</div>
          <input
            value={shipment}
            onChange={(e) => setShipment(e.target.value)}
            placeholder="FBA15KQ8N7X2 · BGY1 Milano"
            className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 font-mono text-[13px] text-ink"
          />
        </div>
      )}

      <button onClick={toScan} className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-extrabold text-white">
        Start scanning <ArrowRight size={17} strokeWidth={2.2} />
      </button>
    </div>
  );
}

import { useApp } from '../state/AppContext';
import { COUNTRIES } from '../lib/carriers';
import { docNumber } from '../lib/format';

export default function SessionSetup() {
  const app = useApp();
  const { direction, carrier, setCarrier, toScan, shift, carriers: dynamicCarriers } = app;
  const isOut = direction === 'out';
  const nextDoc = docNumber(direction, app.docSeq?.[direction] ?? 1);
  const carriers = dynamicCarriers.map((c) => c.name);
  const countryName = COUNTRIES.find((c) => c.code === shift?.country)?.name;

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
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">
          Courier {countryName && <span className="normal-case text-light">· {countryName}</span>}
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))' }}>
          {carriers.map((c) => (
            <button
              key={c}
              onClick={() => {
                // Nothing else to fill in on this screen — jump straight to
                // scanning the moment a carrier's picked, for both
                // directions, instead of making the operator tap a second
                // "Start scanning" button.
                setCarrier(c);
                toScan();
              }}
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
    </div>
  );
}

import { useApp } from '../state/AppContext';
import { Check, Printer, FileText, Mail } from '../components/icons';

export default function Confirmation() {
  const { confirmedDoc, printDocument, printDdt, emailDocument, goToDocsTab } = useApp();
  if (!confirmedDoc) return null;
  const dmgCount = confirmedDoc.parcels.filter((p) => p.damage).length;
  const boxes = confirmedDoc.parcels.reduce((a, p) => a + p.boxes, 0);

  return (
    <div className="flex animate-fadeUpSlow flex-col gap-[18px] px-4 py-[22px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-tint">
          <Check size={32} strokeWidth={2.6} className="text-success" />
        </div>
        <div>
          <div className="text-[20px] font-extrabold tracking-[-.02em]">Handover recorded</div>
          <div className="mt-1 font-mono text-[13px] font-bold text-primary">{confirmedDoc.doc}</div>
          <div className="mt-0.5 text-xs text-secondary">{confirmedDoc.docTime}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
        <Row label="Direction" value={confirmedDoc.direction === 'out' ? 'Outbound' : 'Inbound'} />
        <Row label="Parcels / boxes" value={`${confirmedDoc.parcels.length} parcels / ${boxes} boxes`} />
        <Row label="Driver" value={confirmedDoc.driverName} />
        <Row label="Damaged" value={dmgCount === 0 ? 'none' : `${dmgCount} parcel${dmgCount > 1 ? 's' : ''}`} valueColor={dmgCount ? '#DC2626' : '#16A34A'} last />
      </div>

      {(confirmedDoc.ddtExcluded || []).length > 0 && (
        <div className="rounded-2xl border border-[rgba(220,38,38,.35)] bg-[rgba(220,38,38,.06)] px-[13px] py-3">
          <div className="text-[12px] font-bold text-danger">
            {confirmedDoc.ddtExcluded.length} parcel{confirmedDoc.ddtExcluded.length > 1 ? 's' : ''} on no delivery note
          </div>
          <div className="mt-1 text-[11px] leading-[1.5] text-secondary">
            The Prep-Center did not recognise these tracking IDs, so they are on no DDT:
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink">{confirmedDoc.ddtExcluded.join(', ')}</div>
        </div>
      )}

      {/* The delivery notes go with the driver, so they have to be printable
          here, at the bay — one per shipment, because that is how they were
          issued. Anything that could not be placed is said plainly: it is the
          operator's last chance to fix it while the driver is still present. */}
      {(confirmedDoc.ddts || []).length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
          <div className="border-b border-[rgba(148,163,184,.25)] bg-page px-[13px] py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-secondary">
            Delivery notes ({confirmedDoc.ddts.length})
          </div>
          {confirmedDoc.ddts.map((d) => (
            <button
              key={d.shipmentId}
              onClick={() => printDdt(d)}
              className="flex w-full items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] px-[13px] py-3 text-left last:border-b-0"
            >
              <Printer size={16} strokeWidth={2} className="flex-none text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] font-bold text-ink">{d.number}</div>
                <div className="truncate text-[11px] text-secondary">
                  {d.fbaId || d.shipmentId} · {d.parcels.length} box{d.parcels.length > 1 ? 'es' : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <button onClick={() => printDocument(confirmedDoc)} className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl bg-primary text-[15px] font-extrabold text-white">
          <Printer size={18} strokeWidth={2} /> Print A4 document
        </button>
        <button onClick={goToDocsTab} className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(148,163,184,.4)] bg-white text-sm font-bold text-ink">
          <FileText size={17} strokeWidth={2} /> View document
        </button>
        <button onClick={() => emailDocument(confirmedDoc)} className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(148,163,184,.4)] bg-white text-sm font-bold text-ink">
          <Mail size={17} strokeWidth={2} /> Email PDF
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor, last }) {
  return (
    <div className={'flex justify-between px-[13px] py-2.5' + (last ? '' : ' border-b border-[rgba(148,163,184,.15)]')}>
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-xs font-bold" style={{ color: valueColor }}>{value}</span>
    </div>
  );
}

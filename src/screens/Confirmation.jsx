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

      {/* Two different reasons a parcel is on no DDT, and they call for opposite
          actions. "Not recognised" means check the label or the shipping record.
          "Could not check" means nothing is wrong with the parcel — the lookup
          failed, and Sync now will issue the document later. Saying the first
          when the second happened sends the operator hunting a problem that
          isn't theirs, so each is named, with the reason the app was given. */}
      {(confirmedDoc.ddtExcluded || []).length > 0 && (() => {
        const detail = confirmedDoc.excludedDetail
          || confirmedDoc.ddtExcluded.map((code) => ({ code, status: 'unchecked', error: null }));
        const noted = detail.filter((d) => d.status === 'noted');
        const unknown = detail.filter((d) => d.status === 'unknown');
        const unchecked = detail.filter((d) => d.status !== 'unknown' && d.status !== 'noted');
        const reason = unchecked.find((d) => d.error)?.error;
        return (
          <div className="rounded-2xl border border-[rgba(220,38,38,.35)] bg-[rgba(220,38,38,.06)] px-[13px] py-3">
            <div className="text-[12px] font-bold text-danger">
              {detail.length} parcel{detail.length > 1 ? 's' : ''} on no delivery note
            </div>
            {/* Already on someone else's note. Not an error to chase — the
                document exists and the goods left; what matters is that the
                box in front of the operator is probably not the one they
                think it is. */}
            {noted.length > 0 && (
              <>
                <div className="mt-1.5 text-[11px] leading-[1.5] text-secondary">
                  {noted.length > 1 ? 'These parcels have' : 'This parcel has'} already shipped on an earlier
                  delivery note, so {noted.length > 1 ? 'they were' : 'it was'} not put on a second one:
                </div>
                {noted.map((d) => (
                  <div key={d.code} className="mt-1 font-mono text-[11px] text-ink">
                    {d.code} — {d.notedOn}
                  </div>
                ))}
              </>
            )}
            {unknown.length > 0 && (
              <>
                <div className="mt-1.5 text-[11px] leading-[1.5] text-secondary">
                  The Prep-Center answered, and does not recognise {unknown.length > 1 ? 'these tracking IDs' : 'this tracking ID'}:
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink">{unknown.map((d) => d.code).join(', ')}</div>
                {/* One unrecognised label is a label to go and check. Every
                    label in the session unrecognised is not twenty bad labels —
                    it is the Prep-Center holding no shipping for any of them,
                    and the operator can finish the handover right now by typing
                    the reference. Sending them to inspect the labels instead
                    would waste the time the driver is standing there. */}
                {unknown.length === detail.length && unknown.length > 2 && (
                  <div className="mt-1.5 text-[10.5px] leading-[1.45] text-light">
                    Not one parcel in this session was recognised, so this is far more likely
                    to be the Prep-Center than the labels. Type the shipping reference on the
                    scan screen and the delivery notes are issued from that.
                  </div>
                )}
              </>
            )}
            {unchecked.length > 0 && (
              <>
                <div className="mt-2 text-[11px] leading-[1.5] text-secondary">
                  {unchecked.length > 1 ? 'These could not be checked' : 'This one could not be checked'} at
                  all — nothing is wrong with the {unchecked.length > 1 ? 'parcels' : 'parcel'}. Sync now will
                  issue the {unchecked.length > 1 ? 'documents' : 'document'} once the Prep-Center answers:
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink">{unchecked.map((d) => d.code).join(', ')}</div>
                {reason && <div className="mt-1.5 text-[10.5px] leading-[1.45] text-light">{reason}</div>}
              </>
            )}
          </div>
        );
      })()}

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

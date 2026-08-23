import { useApp } from '../state/AppContext';
import { Check, Printer, FileText, Mail } from '../components/icons';

export default function Confirmation() {
  const { confirmedDoc, printDocument, emailDocument, goToDocsTab } = useApp();
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

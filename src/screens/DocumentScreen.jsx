import { useApp } from '../state/AppContext';

export default function DocumentScreen() {
  const { confirmedDoc, printDocument, goHome } = useApp();

  if (!confirmedDoc) {
    return (
      <div className="flex flex-col gap-3 px-3.5 py-10 text-center">
        <div className="text-sm font-bold text-ink">No document yet</div>
        <div className="text-xs text-secondary">Close and sign a session to generate a handover document.</div>
      </div>
    );
  }

  const boxes = confirmedDoc.parcels.reduce((a, p) => a + p.boxes, 0);

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div className="rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white p-[13px]">
        <div className="font-mono text-sm font-bold text-primary">{confirmedDoc.doc}</div>
        <div className="mt-[3px] text-xs text-secondary">{confirmedDoc.docTime} · {confirmedDoc.parcels.length} parcels / {boxes} boxes</div>
        <div className="text-xs text-secondary">{confirmedDoc.driverName} · {confirmedDoc.courierCompany}</div>
      </div>
      <div className="text-xs leading-normal text-secondary">
        Generating a PDF opens the Android share sheet — from there you can print, save, or send it by email.
      </div>
      <button onClick={() => printDocument(confirmedDoc)} className="min-h-[52px] w-full rounded-xl bg-primary text-sm font-extrabold text-white">
        Print A4 document
      </button>
      <button onClick={goHome} className="min-h-12 w-full rounded-xl border border-[rgba(148,163,184,.4)] bg-white text-sm font-bold text-ink">
        Back to home
      </button>
    </div>
  );
}

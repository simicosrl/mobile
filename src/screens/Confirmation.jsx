import { useApp } from '../state/AppContext';
import { useReceiving } from '../state/ReceivingContext';
import { RECEIVING_ENABLED } from '../lib/features';
import { Check, Printer, FileText, Mail, PackageCheck } from '../components/icons';
import { t } from '../i18n';

export default function Confirmation() {
  const { confirmedDoc, printDocument, printDdt, emailDocument, openSession, shift } = useApp();
  const { lookupHandover } = useReceiving();
  if (!confirmedDoc) return null;
  // Parcels a courier just delivered: the next job is receiving their goods.
  const canReceive = RECEIVING_ENABLED && confirmedDoc.direction !== 'out' && !!shift?.prep && confirmedDoc.parcels.some((p) => p.code);
  const dmgCount = confirmedDoc.parcels.filter((p) => p.damage).length;
  const boxes = confirmedDoc.parcels.reduce((a, p) => a + p.boxes, 0);

  return (
    <div className="flex animate-fadeUpSlow flex-col gap-[18px] px-4 py-[22px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-tint">
          <Check size={32} strokeWidth={2.6} className="text-success" />
        </div>
        <div>
          <div className="text-[20px] font-extrabold tracking-[-.02em]">{t('Handover recorded')}</div>
          <div className="mt-1 font-mono text-[13px] font-bold text-primary">{confirmedDoc.doc}</div>
          <div className="mt-0.5 text-xs text-secondary">{confirmedDoc.docTime}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
        <Row label={t('Direction')} value={confirmedDoc.direction === 'out' ? t('Outbound') : t('Inbound')} />
        <Row label={t('Parcels / boxes')} value={t('{parcels} parcels / {boxes} boxes', { parcels: confirmedDoc.parcels.length, boxes })} />
        <Row label={t('Driver')} value={confirmedDoc.driverName} />
        <Row label={t('Damaged')} value={dmgCount === 0 ? t('none') : dmgCount > 1 ? t('{n} parcels', { n: dmgCount }) : t('{n} parcel', { n: dmgCount })} valueColor={dmgCount ? '#DC2626' : '#16A34A'} last />
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
              {detail.length > 1
                ? t('{n} parcels on no delivery note', { n: detail.length })
                : t('{n} parcel on no delivery note', { n: detail.length })}
            </div>
            {/* Already on someone else's note. Not an error to chase — the
                document exists and the goods left; what matters is that the
                box in front of the operator is probably not the one they
                think it is. */}
            {noted.length > 0 && (
              <>
                <div className="mt-1.5 text-[11px] leading-[1.5] text-secondary">
                  {noted.length > 1
                    ? t('These parcels have already shipped on an earlier delivery note, so they were not put on a second one:')
                    : t('This parcel has already shipped on an earlier delivery note, so it was not put on a second one:')}
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
                  {unknown.length > 1
                    ? t('The Prep-Center answered, and does not recognise these tracking IDs:')
                    : t('The Prep-Center answered, and does not recognise this tracking ID:')}
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
                    {t('Not one parcel in this session was recognised, so this is far more likely to be the Prep-Center than the labels. Type the shipping reference on the scan screen and the delivery notes are issued from that.')}
                  </div>
                )}
              </>
            )}
            {unchecked.length > 0 && (
              <>
                <div className="mt-2 text-[11px] leading-[1.5] text-secondary">
                  {unchecked.length > 1
                    ? t('These could not be checked at all — nothing is wrong with the parcels. Sync now will issue the documents once the Prep-Center answers:')
                    : t('This one could not be checked at all — nothing is wrong with the parcel. Sync now will issue the document once the Prep-Center answers:')}
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
            {t('Delivery notes ({n})', { n: confirmedDoc.ddts.length })}
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
                  {d.fbaId || d.shipmentId} · {d.parcels.length > 1 ? t('{n} boxes', { n: d.parcels.length }) : t('{n} box', { n: d.parcels.length })}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {canReceive && (
          <button
            onClick={() => lookupHandover(confirmedDoc.parcels.map((p) => p.code), `${confirmedDoc.parcels.length === 1 ? t('{n} parcel', { n: 1 }) : t('{n} parcels', { n: confirmedDoc.parcels.length })} · ${confirmedDoc.doc}`)}
            className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl bg-success text-[15px] font-extrabold text-white"
          >
            <PackageCheck size={19} strokeWidth={2} /> {t('Receive these parcels into stock')}
          </button>
        )}
        <button onClick={() => printDocument(confirmedDoc)} className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl bg-primary text-[15px] font-extrabold text-white">
          <Printer size={18} strokeWidth={2} /> {t('Print A4 document')}
        </button>
        <button onClick={() => openSession(confirmedDoc.doc)} className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(148,163,184,.4)] bg-white text-sm font-bold text-ink">
          <FileText size={17} strokeWidth={2} /> {t('View document')}
        </button>
        <button onClick={() => emailDocument(confirmedDoc)} className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(148,163,184,.4)] bg-white text-sm font-bold text-ink">
          <Mail size={17} strokeWidth={2} /> {t('Email PDF')}
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

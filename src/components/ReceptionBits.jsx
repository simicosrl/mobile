import { clientLabel, receptionTrackings } from '../lib/prepReceiving';
import { ChevronRight } from './icons';

// Small pieces shared by the receiving screens.

const STATUS = {
  submitted: { label: 'To receive', cls: 'bg-[rgba(31,111,235,.1)] text-primary' },
  partial: { label: 'Partial', cls: 'bg-[rgba(255,122,0,.12)] text-accent-dark' },
  received: { label: 'Received', cls: 'bg-success-tint text-success-dark' },
  processed: { label: 'Processed', cls: 'bg-success-tint text-success-dark' },
  forwarded: { label: 'Forwarded', cls: 'bg-segtrack text-secondary' },
  partially_forwarded: { label: 'Part. forwarded', cls: 'bg-segtrack text-secondary' },
  cancelled: { label: 'Cancelled', cls: 'bg-danger-tint text-danger-dark' },
  draft: { label: 'Draft', cls: 'bg-segtrack text-secondary' },
};

export function StatusChip({ status }) {
  const s = STATUS[String(status || '').toLowerCase()] || { label: status || '—', cls: 'bg-segtrack text-secondary' };
  return <span className={`flex-none rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.04em] ${s.cls}`}>{s.label}</span>;
}

/** "10 Oct" — a date that can't be mistaken for a count like 9/10. */
export function dayMonth(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
}

/** One reception in a list (open receptions, search or tracking results). */
export function ReceptionRow({ row, onOpen, highlight }) {
  const trackings = receptionTrackings(row);
  const first = highlight && trackings.includes(highlight) ? highlight : trackings[0];
  return (
    <button
      onClick={() => onOpen(row.id)}
      className="flex w-full items-center gap-3 rounded-xl border border-[rgba(148,163,184,.25)] bg-white p-3 text-left shadow-card"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 truncate text-[14px] font-extrabold tracking-[-.01em]">{clientLabel(row)}</div>
          <StatusChip status={row.computed_status || row.status} />
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-secondary">
          {first || 'No tracking'}{trackings.length > 1 ? ` +${trackings.length - 1}` : ''}
        </div>
        <div className="mt-0.5 text-[11px] text-secondary">
          {Number(row.line_count || 0)} product{Number(row.line_count) === 1 ? '' : 's'} · {Number(row.total_units || 0)} units
          {row.created_at ? ` · announced ${dayMonth(row.created_at)}` : ''}
          {String(row.import_source || '').toLowerCase() === 'amazon_removal_order' ? ' · Amazon removal' : ''}
        </div>
      </div>
      <ChevronRight size={17} strokeWidth={2.2} className="flex-none text-light" />
    </button>
  );
}

import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { ArrowDownToLine, Truck, ChevronRight, Download, X } from '../components/icons';
import { hhmm } from '../lib/format';

export default function Home() {
  const { shift, startSession, history, endShift, updateInfo, updateDismissed, dismissUpdate, downloadUpdate } = useApp();

  const today = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('en-GB');
    const todays = history.filter((h) => h.date.startsWith(todayStr));
    const boxesOf = (d) => d.parcels.reduce((a, p) => a + p.boxes, 0);
    return {
      in: todays.filter((h) => h.direction === 'in').reduce((a, h) => a + boxesOf(h), 0),
      out: todays.filter((h) => h.direction === 'out').reduce((a, h) => a + boxesOf(h), 0),
      damaged: todays.reduce((a, h) => a + h.parcels.filter((p) => p.damage).length, 0),
    };
  }, [history]);

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-4">
      {updateInfo?.available && !updateDismissed && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-[rgba(31,111,235,.3)] bg-[rgba(31,111,235,.07)] p-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold text-primary">Update available — v{updateInfo.versionName}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-secondary">Downloads via your browser; open the file afterwards to install.</div>
          </div>
          <button onClick={downloadUpdate} className="flex h-9 flex-none items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white">
            <Download size={14} strokeWidth={2.2} /> Get it
          </button>
          <button onClick={dismissUpdate} aria-label="Dismiss" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-secondary">
            <X size={15} strokeWidth={2.2} />
          </button>
        </div>
      )}
      <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-3.5 shadow-card">
        <div className="flex items-center justify-between gap-2.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.1em] text-light">On shift</div>
            <div className="mt-0.5 text-[16px] font-extrabold tracking-[-.015em]">{shift?.operatorName}</div>
            <div className="font-mono text-[11px] text-secondary">
              {shift?.badgeId} · since {shift ? hhmm(new Date(shift.startedAt)) : ''}
            </div>
          </div>
          <div className="h-[9px] w-[9px] rounded-full bg-success" style={{ boxShadow: '0 0 0 4px rgba(22,163,74,.15)' }} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          onClick={() => startSession('in')}
          className="flex items-center gap-3.5 rounded-2xl border border-[rgba(31,111,235,.25)] p-[18px_16px] text-left"
          style={{ background: 'linear-gradient(135deg,rgba(31,111,235,.08),rgba(31,111,235,.02))', padding: '18px 16px' }}
        >
          <div className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-2xl bg-primary text-white">
            <ArrowDownToLine size={26} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="text-[18px] font-extrabold tracking-[-.02em]">Inbound</div>
            <div className="text-xs leading-snug text-secondary">Receive parcels from a courier</div>
          </div>
          <ChevronRight size={18} strokeWidth={2.2} className="ml-auto flex-none text-light" />
        </button>

        <button
          onClick={() => startSession('out')}
          className="flex items-center gap-3.5 rounded-2xl border border-[rgba(255,122,0,.3)] text-left"
          style={{ background: 'linear-gradient(135deg,rgba(255,122,0,.1),rgba(255,122,0,.02))', padding: '18px 16px' }}
        >
          <div className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-2xl bg-accent text-white">
            <Truck size={26} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="text-[18px] font-extrabold tracking-[-.02em]">Outbound</div>
            <div className="text-xs leading-snug text-secondary">Hand parcels over for pickup</div>
          </div>
          <ChevronRight size={18} strokeWidth={2.2} className="ml-auto flex-none text-light" />
        </button>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.1em] text-light">Today</div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-[rgba(148,163,184,.25)] bg-white p-[11px_10px]">
            <div className="text-[22px] font-extrabold tracking-[-.03em] text-primary">{today.in}</div>
            <div className="text-[10px] leading-tight text-secondary">boxes in</div>
          </div>
          <div className="rounded-xl border border-[rgba(148,163,184,.25)] bg-white p-[11px_10px]">
            <div className="text-[22px] font-extrabold tracking-[-.03em] text-accent">{today.out}</div>
            <div className="text-[10px] leading-tight text-secondary">boxes out</div>
          </div>
          <div className="rounded-xl border border-[rgba(148,163,184,.25)] bg-white p-[11px_10px]">
            <div className="text-[22px] font-extrabold tracking-[-.03em] text-danger">{today.damaged}</div>
            <div className="text-[10px] leading-tight text-secondary">damaged</div>
          </div>
        </div>
      </div>

      <button onClick={endShift} className="mt-1 self-center text-[11.5px] font-bold text-secondary underline underline-offset-2">
        End shift
      </button>
    </div>
  );
}

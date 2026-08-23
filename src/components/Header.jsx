import { useApp } from '../state/AppContext';
import { ChevronLeft, Settings } from './icons';
import { hhmm, docNumber } from '../lib/format';

function headerCopy(app) {
  const { screen, direction, confirmedDoc, selectedDocNo, history, carrier, docSeq, orgSettings } = app;
  const isOut = direction === 'out';
  const sel = history.find((h) => h.doc === selectedDocNo);
  const sessionDocLabel = docNumber(direction, docSeq[direction]);
  const docLabel = confirmedDoc?.doc || sessionDocLabel;

  if (screen === 'api') return { title: 'API & integrations', sub: 'Send and receive warehouse data' };
  if (screen === 'settings') return { title: 'Settings', sub: 'Operator, warehouse & company' };
  if (screen === 'home') return { title: 'SIMICO Warehouse', sub: `${orgSettings.warehouseLocation} · ${orgSettings.warehouseDock}` };
  if (screen === 'setup') return { title: 'New session', sub: '' };
  if (screen === 'scan') return { title: isOut ? 'Outbound scan' : 'Inbound scan', sub: `${sessionDocLabel} · ${carrier}` };
  if (screen === 'sign') return { title: 'Driver signature', sub: `${sessionDocLabel} · ${carrier}` };
  if (screen === 'confirm') return { title: 'Session closed', sub: `${docLabel} · ${carrier}` };
  if (screen === 'doc') return { title: 'Documents', sub: `${history.length} handover document${history.length === 1 ? '' : 's'}` };
  if (screen === 'session') return { title: sel ? sel.doc : 'Session', sub: sel ? `${sel.direction === 'out' ? 'Outbound' : 'Inbound'} · ${sel.date}` : '' };
  return { title: 'History', sub: 'Sessions and parcels' };
}

export default function Header() {
  const app = useApp();
  const { canGoBack, goBack, shift, now, screen, goToSettings } = app;
  const { title, sub } = headerCopy(app);

  return (
    <div className="flex items-center justify-between gap-2.5 border-b border-[rgba(148,163,184,.25)] bg-white px-3.5 py-3 safe-top">
      <div className="flex min-w-0 items-center gap-2.5">
        {canGoBack && (
          <button
            onClick={goBack}
            aria-label="Back"
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-[rgba(148,163,184,.3)] bg-white text-ink"
          >
            <ChevronLeft size={17} />
          </button>
        )}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-extrabold tracking-[-.015em]">{title}</div>
          <div className="truncate text-[10px] text-secondary">{sub}</div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-2">
        <div className="font-mono text-[11px] text-secondary">{hhmm(new Date(now))}</div>
        {screen !== 'settings' && (
          <button
            onClick={goToSettings}
            aria-label="Settings"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(148,163,184,.3)] text-secondary"
          >
            <Settings size={15} strokeWidth={2} />
          </button>
        )}
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-white">
          {(shift?.operatorName || '??')
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </div>
      </div>
    </div>
  );
}

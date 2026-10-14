import { useApp } from '../state/AppContext';
import { useKeyboardOpen } from '../hooks/useKeyboardOpen';
import { House, ArrowDownToLine, Truck, FileText } from './icons';

function Tab({ active, label, Icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex min-h-[56px] flex-1 flex-col items-center gap-[3px] py-[9px] pb-[11px] text-[10px] font-bold ' +
        (active ? 'text-primary' : 'text-light')
      }
    >
      <Icon size={19} />
      {label}
    </button>
  );
}

// Home · Inbound · Outbound · DDT. A handover opened from a list keeps that
// list's tab lit; API & integrations lives in Settings.
// Hidden while the keyboard is open: it only takes room from what is being typed.
export default function BottomNav() {
  const keyboardOpen = useKeyboardOpen();
  const { screen, goHome, goToInboundTab, goToOutboundTab, goToDdtTab, history, selectedDocNo } = useApp();
  if (keyboardOpen) return null;
  const openDir = screen === 'session' ? history.find((h) => h.doc === selectedDocNo)?.direction : null;
  return (
    <div className="flex border-t border-[rgba(148,163,184,.25)] bg-white safe-bottom">
      <Tab active={['home', 'setup', 'scan', 'sign', 'confirm', 'recvStart', 'recvOrder', 'stockCheck'].includes(screen)} label="Home" Icon={House} onClick={goHome} />
      <Tab active={screen === 'inbound' || openDir === 'in'} label="Inbound" Icon={ArrowDownToLine} onClick={goToInboundTab} />
      <Tab active={screen === 'outbound' || openDir === 'out'} label="Outbound" Icon={Truck} onClick={goToOutboundTab} />
      <Tab active={screen === 'ddts'} label="DDT" Icon={FileText} onClick={goToDdtTab} />
    </div>
  );
}

import { useApp } from '../state/AppContext';
import { House, ClockIcon, FileText, Globe } from './icons';

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

export default function BottomNav() {
  const { screen, goHome, goToHistoryTab, goToDocsTab, goToApiTab } = useApp();
  return (
    <div className="flex border-t border-[rgba(148,163,184,.25)] bg-white safe-bottom">
      <Tab active={screen === 'home' || screen === 'setup' || screen === 'scan' || screen === 'sign'} label="Home" Icon={House} onClick={goHome} />
      <Tab active={screen === 'history' || screen === 'session'} label="History" Icon={ClockIcon} onClick={goToHistoryTab} />
      <Tab active={screen === 'doc' || screen === 'confirm'} label="Docs" Icon={FileText} onClick={goToDocsTab} />
      <Tab active={screen === 'api'} label="API" Icon={Globe} onClick={goToApiTab} />
    </div>
  );
}

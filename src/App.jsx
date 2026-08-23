import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { AppProvider, useApp } from './state/AppContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Toast from './components/Toast';
import DuplicateSheet from './components/DuplicateSheet';
import DamageSheet from './components/DamageSheet';
import PhotoViewer from './components/PhotoViewer';
import BadgeLogin from './screens/BadgeLogin';
import Home from './screens/Home';
import SessionSetup from './screens/SessionSetup';
import Scan from './screens/Scan';
import Signature from './screens/Signature';
import Confirmation from './screens/Confirmation';
import DocumentScreen from './screens/DocumentScreen';
import History from './screens/History';
import SessionDetail from './screens/SessionDetail';
import ApiScreen from './screens/ApiScreen';
import Settings from './screens/Settings';

const SCREENS = {
  home: Home,
  setup: SessionSetup,
  scan: Scan,
  sign: Signature,
  confirm: Confirmation,
  doc: DocumentScreen,
  history: History,
  session: SessionDetail,
  api: ApiScreen,
  settings: Settings,
};

function Shell() {
  const { ready, screen, goBack, goHome, canGoBack } = useApp();

  useEffect(() => {
    let handle;
    CapacitorApp.addListener('backButton', () => {
      if (canGoBack) goBack();
      else if (screen !== 'home' && screen !== 'login') goHome();
      else CapacitorApp.exitApp();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [canGoBack, goBack, goHome, screen]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0F172A] text-white">
        <div className="text-sm font-bold tracking-wide">SIMICO Warehouse Scan</div>
      </div>
    );
  }

  if (screen === 'login') return <BadgeLogin />;

  const Screen = SCREENS[screen] || Home;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-page">
      <Header />
      <div className="flex-1 overflow-y-auto">
        <Screen />
      </div>
      <BottomNav />
      <DuplicateSheet />
      <DamageSheet />
      <PhotoViewer />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

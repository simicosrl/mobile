import { useApp } from '../state/AppContext';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className="absolute left-3.5 right-3.5 bottom-20 z-30 rounded-xl bg-ink px-3.5 py-3 text-[12.5px] font-semibold text-white shadow-toast animate-fadeUp">
      {toast}
    </div>
  );
}

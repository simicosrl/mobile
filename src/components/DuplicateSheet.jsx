import { useApp } from '../state/AppContext';
import { TriangleAlert } from './icons';

export default function DuplicateSheet() {
  const { dupCode, dupTime, closeDup, dupAddBox } = useApp();
  if (!dupCode) return null;
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-[rgba(15,20,28,.55)] p-4">
      <div className="w-full animate-fadeUp rounded-[18px] border-t-[5px] border-danger bg-white p-[18px]">
        <div className="flex items-center gap-2.5">
          <TriangleAlert size={22} className="text-danger" strokeWidth={2.2} />
          <div className="text-[17px] font-extrabold tracking-[-.01em] text-danger-dark">Duplicate scan blocked</div>
        </div>
        <div className="mt-3 break-all font-mono text-[12.5px] font-bold">{dupCode}</div>
        <div className="mt-1.5 text-[12.5px] leading-normal text-secondary">
          Already recorded in this session at {dupTime}. Increase the box count on the existing line instead of scanning it again.
        </div>
        <div className="mt-4 flex gap-2.5">
          <button
            onClick={closeDup}
            className="min-h-[48px] flex-1 rounded-[11px] border border-[rgba(148,163,184,.4)] bg-white text-[13px] font-bold text-ink"
          >
            Dismiss
          </button>
          <button onClick={dupAddBox} className="min-h-[48px] flex-1 rounded-[11px] bg-ink text-[13px] font-bold text-white">
            +1 box
          </button>
        </div>
      </div>
    </div>
  );
}

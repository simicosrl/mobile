import { useApp } from '../state/AppContext';
import { X } from './icons';

export default function PhotoViewer() {
  const { viewingPhoto, closePhoto } = useApp();
  if (!viewingPhoto) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/95 p-4" onClick={closePhoto}>
      <button
        onClick={closePhoto}
        aria-label="Close"
        className="flex h-9 w-9 flex-none items-center justify-center self-end rounded-full bg-white/15 text-white"
      >
        <X size={18} />
      </button>
      <div className="flex flex-1 items-center justify-center">
        <img src={viewingPhoto} alt="Damage attachment" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

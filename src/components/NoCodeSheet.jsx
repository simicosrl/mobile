import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { useApp } from '../state/AppContext';
import { Camera } from './icons';

export default function NoCodeSheet() {
  const { noCodeSheet, closeNoCodeSheet, setNoCodeNote, setNoCodePhoto, saveNoCode, showToast } = useApp();
  if (!noCodeSheet.open) return null;
  const ready = !!noCodeSheet.photoDataUrl;

  const takePhoto = async () => {
    try {
      const photo = await CapCamera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        quality: 70,
        allowEditing: false,
        width: 1600,
        height: 1600,
      });
      setNoCodePhoto(`data:image/${photo.format || 'jpeg'};base64,${photo.base64String}`);
    } catch (err) {
      if (String(err?.message || '').toLowerCase().includes('cancel')) return;
      showToast('Could not capture a photo — check camera permission');
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end overflow-y-auto bg-[rgba(15,20,28,.55)] p-4">
      <div className="w-full animate-fadeUp rounded-[18px] bg-white p-[18px]">
        <div className="text-[17px] font-extrabold tracking-[-.015em]">Log without a valid code</div>
        <div className="mt-1 text-[12px] leading-snug text-secondary">
          For a torn or unreadable label, or a code that doesn't match this carrier. A photo stands in for the
          code so the office can reconcile it — this parcel is flagged clearly in the session.
        </div>

        <div className="mt-3.5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Photo · required</div>
          <button
            onClick={takePhoto}
            className={
              'flex min-h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-[13px] border-2 border-dashed ' +
              (noCodeSheet.photoDataUrl ? 'border-success bg-success-tint2 text-success-dark' : 'border-[rgba(148,163,184,.5)] bg-page text-secondary')
            }
          >
            {noCodeSheet.photoDataUrl ? (
              <img src={noCodeSheet.photoDataUrl} alt="Captured parcel" className="h-14 rounded-md object-cover" />
            ) : (
              <Camera size={24} strokeWidth={1.8} />
            )}
            <div className="text-[12.5px] font-bold">
              {noCodeSheet.photoDataUrl ? 'Photo captured' : 'Take photo'}
            </div>
          </button>
        </div>

        <div className="mt-3.5">
          <input
            value={noCodeSheet.note}
            onChange={(e) => setNoCodeNote(e.target.value)}
            placeholder="Note (optional) — e.g. label torn, wrong carrier printed"
            className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-[13px] text-ink"
          />
        </div>

        <div className="mt-4 flex gap-2.5">
          <button onClick={closeNoCodeSheet} className="min-h-[50px] w-24 flex-none rounded-[11px] border border-[rgba(148,163,184,.4)] bg-white text-[13px] font-bold text-ink">
            Cancel
          </button>
          <button
            onClick={saveNoCode}
            className={'min-h-[50px] flex-1 rounded-[11px] text-[14px] font-extrabold text-white ' + (ready ? 'cursor-pointer bg-[#FF7A00]' : 'cursor-not-allowed bg-disabled')}
          >
            Log parcel
          </button>
        </div>
      </div>
    </div>
  );
}

import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { useApp } from '../state/AppContext';
import { Camera } from './icons';

export default function DamageSheet() {
  const { damageSheet, closeDamage, toggleDamageType, setDamageNote, setDamagePhoto, saveDamage, damageTypes, parcels, showToast } = useApp();
  if (!damageSheet.open) return null;
  const lastCode = parcels.length ? parcels[parcels.length - 1].code : '';
  const ready = damageSheet.picks.length > 0 && !!damageSheet.photoDataUrl;

  const takePhoto = async () => {
    try {
      const photo = await CapCamera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        quality: 70,
        allowEditing: false,
      });
      setDamagePhoto(`data:image/${photo.format || 'jpeg'};base64,${photo.base64String}`);
    } catch (err) {
      if (String(err?.message || '').toLowerCase().includes('cancel')) return;
      showToast('Could not capture a photo — check camera permission');
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end overflow-y-auto bg-[rgba(15,20,28,.55)] p-4">
      <div className="w-full animate-fadeUp rounded-[18px] bg-white p-[18px]">
        <div className="text-[17px] font-extrabold tracking-[-.015em]">Report damage</div>
        <div className="mt-1 break-all font-mono text-xs text-secondary">{lastCode}</div>

        <div className="mt-3.5 flex flex-col gap-2">
          {damageTypes.map((d) => {
            const on = damageSheet.picks.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDamageType(d)}
                className={
                  'min-h-[50px] w-full rounded-xl border px-3.5 text-left text-[13.5px] font-bold ' +
                  (on ? 'border-danger bg-danger-tint2 text-danger-dark' : 'border-[rgba(148,163,184,.35)] bg-white text-ink')
                }
              >
                {d}
              </button>
            );
          })}
        </div>

        <div className="mt-3.5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Photo · required</div>
          <button
            onClick={takePhoto}
            className={
              'flex min-h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-[13px] border-2 border-dashed ' +
              (damageSheet.photoDataUrl ? 'border-success bg-success-tint2 text-success-dark' : 'border-[rgba(148,163,184,.5)] bg-page text-secondary')
            }
          >
            {damageSheet.photoDataUrl ? (
              <img src={damageSheet.photoDataUrl} alt="Captured damage" className="h-14 rounded-md object-cover" />
            ) : (
              <Camera size={24} strokeWidth={1.8} />
            )}
            <div className="text-[12.5px] font-bold">
              {damageSheet.photoDataUrl ? 'Photo captured' : 'Take photo'}
            </div>
          </button>
        </div>

        <div className="mt-3.5">
          <input
            value={damageSheet.note}
            onChange={(e) => setDamageNote(e.target.value)}
            placeholder="Note (optional)"
            className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-[13px] text-ink"
          />
        </div>

        <div className="mt-4 flex gap-2.5">
          <button onClick={closeDamage} className="min-h-[50px] w-24 flex-none rounded-[11px] border border-[rgba(148,163,184,.4)] bg-white text-[13px] font-bold text-ink">
            Cancel
          </button>
          <button
            onClick={saveDamage}
            className={'min-h-[50px] flex-1 rounded-[11px] text-[14px] font-extrabold text-white ' + (ready ? 'cursor-pointer bg-danger' : 'cursor-not-allowed bg-disabled')}
          >
            Save damage
          </button>
        </div>
      </div>
    </div>
  );
}

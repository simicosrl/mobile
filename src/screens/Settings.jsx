import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../state/AppContext';
import { COUNTRIES, carriersForCountry } from '../lib/carriers';
import { Check, Download } from '../components/icons';

function Field({ label, ...props }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">{label}</div>
      <input
        {...props}
        className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-sm text-ink"
      />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-3.5">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[.1em] text-light">{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { shift, updateOperatorName, setOperatorCountry, orgSettings, updateOrgSettings, showToast, updateInfo, checkUpdateNow, downloadUpdate } = useApp();
  const [name, setName] = useState(shift?.operatorName || '');
  const [org, setOrg] = useState(orgSettings);
  const [saved, setSaved] = useState(false);
  const [appVersion, setAppVersion] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.getInfo().then((info) => setAppVersion(info)).catch(() => {});
    }
  }, []);

  const checkNow = async () => {
    setChecking(true);
    const res = await checkUpdateNow();
    setChecking(false);
    showToast(res.available ? `Update available — v${res.versionName}` : 'You have the latest version');
  };

  const set = (key) => (e) => { setOrg((o) => ({ ...o, [key]: e.target.value })); setSaved(false); };

  const save = async () => {
    if (name.trim().length > 1) await updateOperatorName(name);
    updateOrgSettings(org);
    setSaved(true);
    showToast('Settings saved');
  };

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-3.5">
      <Section title="Operator profile">
        <Field label="Name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Full name" />
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Badge</div>
          <div className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 py-3 font-mono text-sm text-secondary">
            {shift?.badgeId || '—'}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Country</div>
          <div className="grid grid-cols-3 gap-2">
            {COUNTRIES.map((c) => (
              <button
                key={c.code}
                onClick={() => { setOperatorCountry(c.code); showToast(`Country set to ${c.name}`); }}
                className={
                  'min-h-[44px] rounded-[11px] border text-[12.5px] font-bold ' +
                  (shift?.country === c.code
                    ? 'border-primary bg-[rgba(31,111,235,.08)] text-primary'
                    : 'border-[rgba(148,163,184,.35)] bg-white text-ink')
                }
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10.5px] leading-snug text-secondary">
            Sets which couriers show up on the courier picker when starting a session — each country has its
            own carriers.
          </div>
          {shift?.country && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {carriersForCountry(shift.country).map((c) => (
                <div key={c} className="rounded-full bg-page px-2.5 py-1 font-mono text-[10.5px] font-bold text-secondary">
                  {c}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Warehouse">
        <Field label="Location" value={org.warehouseLocation} onChange={set('warehouseLocation')} placeholder="Casazza (BG)" />
        <Field label="Dock / area" value={org.warehouseDock} onChange={set('warehouseDock')} placeholder="Dock 2" />
      </Section>

      <Section title="Company (printed on the A4 document)">
        <Field label="Company name" value={org.companyName} onChange={set('companyName')} placeholder="SIMICO SRL" />
        <Field label="Address" value={org.companyAddress} onChange={set('companyAddress')} placeholder="Street, city, country" />
        <div className="flex gap-2.5">
          <div className="flex-1">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">VAT number</div>
            <input
              value={org.companyVat}
              onChange={set('companyVat')}
              placeholder="P.IVA IT..."
              className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 font-mono text-[13px] text-ink"
            />
          </div>
          <div className="flex-1">
            <Field label="Email" type="email" value={org.companyEmail} onChange={set('companyEmail')} placeholder="warehouse@company.com" />
          </div>
        </div>
      </Section>

      {Capacitor.isNativePlatform() && (
        <Section title="App updates">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-ink">
                {appVersion ? `Installed: v${appVersion.version} (build ${appVersion.build})` : 'Installed version'}
              </div>
              {updateInfo?.available && (
                <div className="mt-0.5 text-[11px] font-bold text-primary">Update available — v{updateInfo.versionName}</div>
              )}
            </div>
            <button
              onClick={checkNow}
              disabled={checking}
              className="flex h-9 flex-none items-center rounded-lg border border-[rgba(148,163,184,.35)] px-3 text-xs font-bold text-ink disabled:opacity-60"
            >
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
          {updateInfo?.available && (
            <button onClick={downloadUpdate} className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-white">
              <Download size={16} strokeWidth={2.2} /> Download update
            </button>
          )}
        </Section>
      )}

      <button
        onClick={save}
        className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-extrabold text-white"
      >
        {saved ? <Check size={18} strokeWidth={2.4} /> : null} {saved ? 'Saved' : 'Save changes'}
      </button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../state/AppContext';
import { Check, Download, ChevronDown, Plus, RefreshCw } from '../components/icons';

// e.g. "25/08/2026 14:47" in the operator's own timezone, from the
// server's UTC timestamp — mirrors the format already used for documents.
function formatLoginTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

// Collapsible so the settings page doesn't turn into one endless scroll as
// more sections (carriers, company details, updates...) get added —
// closed sections default to their summary line only.
function Section({ title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-3.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-light">{title}</div>
          {!open && summary && <div className="mt-0.5 truncate text-[11.5px] text-secondary">{summary}</div>}
        </div>
        <ChevronDown size={16} strokeWidth={2.2} className={'flex-none text-light transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

function CarrierRow({ carrier, onSave }) {
  const [pattern, setPattern] = useState(carrier.pattern || '');
  const [saved, setSaved] = useState(true);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[rgba(148,163,184,.25)] bg-page px-3 py-2">
      <div className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{carrier.name}</div>
      <input
        value={pattern}
        onChange={(e) => { setPattern(e.target.value); setSaved(false); }}
        onBlur={() => { if (!saved) { onSave(carrier.name, pattern); setSaved(true); } }}
        placeholder="no restriction"
        aria-label={`Pattern for ${carrier.name}`}
        className="min-h-[38px] w-[130px] flex-none rounded-lg border border-inputborder bg-white px-2.5 font-mono text-[12px] uppercase text-ink"
      />
    </div>
  );
}

export default function Settings() {
  const {
    shift, updateOperatorName, orgSettings, updateOrgSettings, showToast, updateInfo, checkUpdateNow, downloadUpdate, carriers, saveCarrier,
    loginEvents, pullingLoginEvents, pullLoginEventsNow,
  } = useApp();
  const [name, setName] = useState(shift?.operatorName || '');
  const [org, setOrg] = useState(orgSettings);
  const [saved, setSaved] = useState(false);
  const [appVersion, setAppVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [newCarrierName, setNewCarrierName] = useState('');
  const [newCarrierPattern, setNewCarrierPattern] = useState('');

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

  const addCarrier = () => {
    if (!newCarrierName.trim()) return;
    saveCarrier(newCarrierName, newCarrierPattern);
    showToast(`${newCarrierName.trim().toUpperCase()} added`);
    setNewCarrierName('');
    setNewCarrierPattern('');
  };

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-3.5">
      <Section title="Operator profile" summary={shift?.operatorName} defaultOpen>
        <Field label="Name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Full name" />
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Badge</div>
          <div className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 py-3 font-mono text-sm text-secondary">
            {shift?.badgeId || '—'}
          </div>
        </div>
      </Section>

      <Section title="Warehouse" summary={org.warehouseLocation}>
        <Field label="Location" value={org.warehouseLocation} onChange={set('warehouseLocation')} placeholder="Casazza (BG)" />
        <Field label="Dock / area" value={org.warehouseDock} onChange={set('warehouseDock')} placeholder="Dock 2" />
      </Section>

      <Section title="Company (printed on the A4 document)" summary={org.companyName}>
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

      <Section title="Carriers" summary={`${carriers.length} carrier${carriers.length === 1 ? '' : 's'}`}>
        <div className="text-[11px] leading-snug text-secondary">
          Add a required tracking-code prefix to catch a wrong scan before it's added — e.g. UPS codes always
          start with <span className="font-mono font-bold text-ink">1Z</span>. Leave blank for no restriction.
          Shared with every device logged into this country.
        </div>
        <div className="flex flex-col gap-1.5">
          {carriers.map((c) => (
            <CarrierRow key={c.name} carrier={c} onSave={saveCarrier} />
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-[rgba(148,163,184,.2)] pt-3">
          <input
            value={newCarrierName}
            onChange={(e) => setNewCarrierName(e.target.value)}
            placeholder="New carrier name"
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-inputborder bg-page px-2.5 text-[12.5px] uppercase text-ink"
          />
          <input
            value={newCarrierPattern}
            onChange={(e) => setNewCarrierPattern(e.target.value)}
            placeholder="Prefix (optional)"
            className="min-h-[40px] w-[110px] flex-none rounded-lg border border-inputborder bg-page px-2.5 font-mono text-[12px] uppercase text-ink"
          />
          <button
            onClick={addCarrier}
            disabled={!newCarrierName.trim()}
            aria-label="Add carrier"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary text-white disabled:opacity-50"
          >
            <Plus size={17} strokeWidth={2.4} />
          </button>
        </div>
      </Section>

      <Section title="Login history" summary={loginEvents.length ? `${loginEvents.length} recent logins` : 'Who logged in, from where, and when'}>
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1 text-[11px] leading-snug text-secondary">
            Every badge login for this country, with the IP it came from — recorded server-side, not
            something the phone reports about itself.
          </div>
          <button
            onClick={pullLoginEventsNow}
            disabled={pullingLoginEvents}
            className="flex h-9 flex-none items-center gap-1.5 rounded-lg border border-[rgba(148,163,184,.35)] px-3 text-xs font-bold text-ink disabled:opacity-60"
          >
            <RefreshCw size={14} strokeWidth={2.2} /> {pullingLoginEvents ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {loginEvents.length > 0 && (
          <div className="max-h-[260px] overflow-y-auto rounded-xl border border-[rgba(148,163,184,.25)]">
            {loginEvents.map((e, i) => (
              <div key={`${e.badgeId}-${e.loggedInAtIso}-${i}`} className="flex items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-bold text-ink">{e.operatorName || e.badgeId}</div>
                  <div className="truncate font-mono text-[10.5px] text-secondary">{e.badgeId} · {e.ip || 'unknown IP'}</div>
                </div>
                <div className="flex-none font-mono text-[10.5px] text-secondary">{formatLoginTime(e.loggedInAtIso)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {Capacitor.isNativePlatform() && (
        <Section title="App updates" summary={appVersion ? `v${appVersion.version}` : undefined}>
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

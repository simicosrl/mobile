import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { Check } from '../components/icons';

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
  const { shift, updateOperatorName, orgSettings, updateOrgSettings, showToast } = useApp();
  const [name, setName] = useState(shift?.operatorName || '');
  const [org, setOrg] = useState(orgSettings);
  const [saved, setSaved] = useState(false);

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

      <button
        onClick={save}
        className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-extrabold text-white"
      >
        {saved ? <Check size={18} strokeWidth={2.4} /> : null} {saved ? 'Saved' : 'Save changes'}
      </button>
    </div>
  );
}

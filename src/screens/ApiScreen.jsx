import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { Globe, Download, RefreshCw } from '../components/icons';
import { ENDPOINTS, PAYLOAD_SAMPLE } from '../lib/api';

function Toggle({ on, onClick }) {
  return (
    <div className="flex h-[26px] w-11 flex-none items-center rounded-full p-[3px]" style={{ background: on ? '#1F6FEB' : 'rgba(148,163,184,.45)', justifyContent: on ? 'flex-end' : 'flex-start' }} onClick={onClick}>
      <div className="h-5 w-5 rounded-full bg-white" style={{ boxShadow: '0 1px 2px rgba(15,23,42,.25)' }} />
    </div>
  );
}

export default function ApiScreen() {
  const {
    apiConfig, apiShowKey, setApiBaseUrl, setApiKey, generateApiKey, copyApiKey, togglePush, togglePull, toggleShowKey,
    manifest, pulling, pullManifestNow, syncing, syncNow, retrySync, history,
  } = useApp();
  const [showManifestList, setShowManifestList] = useState(false);

  const hostLabel = apiConfig.baseUrl.replace(/^https?:\/\//, '') || 'no endpoint configured';
  const online = !!apiConfig.baseUrl;
  // Secured (already copied) keys show as blank rather than a masked
  // preview — typing directly into that blank replaces the key outright
  // (the escape hatch back out of "secured" mode), so there's never a
  // masked placeholder sitting in the field that could get saved as-is.
  const keyShown = apiConfig.keySecured
    ? ''
    : apiShowKey
      ? apiConfig.apiKey
      : apiConfig.apiKey.slice(0, 8) + (apiConfig.apiKey.length > 8 ? '••••••••••••' : '');

  const okCount = history.filter((d) => d.syncStatus === 'ok').length;
  const pendingCount = history.filter((d) => d.syncStatus === 'pending' || d.syncStatus === undefined).length;
  const failCount = history.filter((d) => d.syncStatus === 'failed').length;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-3.5">
      <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-3.5 shadow-card">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-[rgba(31,111,235,.1)] text-primary">
            <Globe size={19} strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold tracking-[-.015em]">Your database</div>
            <div className="truncate text-[11px] text-secondary">{hostLabel}</div>
          </div>
          <div className="ml-auto flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: online ? 'rgba(22,163,74,.1)' : 'rgba(220,38,38,.1)' }}>
            <div className="h-[7px] w-[7px] rounded-full" style={{ background: online ? '#16A34A' : '#DC2626' }} />
            <div className="text-[10px] font-extrabold uppercase tracking-[.06em]" style={{ color: online ? '#16A34A' : '#DC2626' }}>{online ? 'Configured' : 'Not set'}</div>
          </div>
        </div>
      </div>

      <div className="border-l-[3px] border-primary bg-[rgba(31,111,235,.06)] px-3 py-2.5 text-[11px] leading-normal text-secondary">
        Every session is saved to this warehouse's own database automatically — set once your country is
        picked in Settings, no setup needed here. The fields below are for troubleshooting only. Other
        systems (e.g. Prep-Center) read their data from this database on their own schedule; the app never
        sends anything to them directly.
      </div>

      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">Base URL</div>
        <input
          value={apiConfig.baseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          placeholder="https://api.simico.srl/v1"
          className="min-h-12 w-full rounded-xl border border-inputborder bg-page px-4 font-mono text-[12.5px] text-ink"
        />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-secondary">API key</div>
        <div className="flex gap-2">
          <input
            value={keyShown}
            onChange={(e) => setApiKey(e.target.value)}
            // While masked, the field shows a placeholder string with •
            // bullet characters — those aren't real key content, so the
            // field must not be editable in that state, or a stray change
            // event (autofill, IME quirks) can write the masked text itself
            // back as the "real" key, corrupting it with characters that
            // later break fetch()'s header encoding entirely.
            readOnly={!apiConfig.keySecured && !apiShowKey && apiConfig.apiKey.length > 0}
            placeholder="whs_…"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-inputborder bg-page px-4 font-mono text-[12.5px] text-ink"
          />
          <button
            onClick={toggleShowKey}
            disabled={apiConfig.keySecured}
            className="min-h-12 w-[52px] flex-none rounded-xl border border-[rgba(148,163,184,.35)] bg-white text-[11px] font-bold text-secondary disabled:opacity-40"
          >
            {apiShowKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={generateApiKey}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-[rgba(31,111,235,.35)] bg-[rgba(31,111,235,.06)] text-[12.5px] font-extrabold text-primary"
          >
            Generate new key
          </button>
          {apiShowKey && !apiConfig.keySecured && apiConfig.apiKey && (
            <button
              onClick={copyApiKey}
              className="flex min-h-11 flex-none items-center justify-center rounded-xl bg-primary px-4 text-[12.5px] font-extrabold text-white"
            >
              Copy
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[10.5px] leading-snug text-secondary">
          {apiConfig.keySecured
            ? 'Hidden for security after being copied — generate a new key, or retype it, to view it again.'
            : "This device's key is already set automatically from its country — only replace it if you're wiring up a separate, additional connection. Generating one here won't work until it's registered on the backend, and picking a country again in Settings restores the working default."}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
        <button onClick={togglePush} className="flex w-full items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] p-[13px] text-left">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold">Send sessions automatically</div>
            <div className="text-[11px] leading-snug text-secondary">On by default — saves every confirmed document to your database</div>
          </div>
          <Toggle on={apiConfig.autoPush} />
        </button>
        <button onClick={togglePull} className="flex w-full items-center gap-2.5 p-[13px] text-left">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold">Receive expected manifest</div>
            <div className="text-[11px] leading-snug text-secondary">GET tracking IDs due today and validate at scan</div>
          </div>
          <Toggle on={apiConfig.autoPull} />
        </button>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.1em] text-light">Incoming · expected manifest</div>
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white p-[13px]">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="text-[26px] font-extrabold tracking-[-.03em] text-primary">{apiConfig.autoPull ? manifest.codes.length : 0}</div>
              <div className="text-[11px] text-secondary">tracking IDs expected</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[11px] text-light">last pull</div>
              <div className="font-mono text-xs font-bold">{apiConfig.autoPull ? manifest.lastPulledAt || '—' : '—'}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => pullManifestNow()} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-[rgba(31,111,235,.35)] bg-[rgba(31,111,235,.06)] text-[13.5px] font-extrabold text-primary">
              <Download size={17} strokeWidth={2} /> {pulling ? 'Pulling…' : 'Pull manifest now'}
            </button>
            <button
              onClick={() => setShowManifestList((v) => !v)}
              disabled={!apiConfig.autoPull || !manifest.codes.length}
              className="min-h-12 flex-none rounded-xl border border-[rgba(148,163,184,.35)] bg-white px-3.5 text-[13.5px] font-bold text-ink disabled:opacity-40"
            >
              {showManifestList ? 'Hide list' : 'View list'}
            </button>
          </div>
          {showManifestList && (
            <div className="max-h-[220px] overflow-y-auto rounded-xl border border-[rgba(148,163,184,.25)] bg-page">
              {manifest.codes.map((code) => (
                <div key={code} className="border-b border-[rgba(148,163,184,.15)] px-3 py-2 font-mono text-[11.5px] text-ink last:border-b-0">
                  {code}
                </div>
              ))}
            </div>
          )}
          <div className="border-l-[3px] border-primary pl-2.5 text-[11px] leading-normal text-secondary">
            A scanned code on the manifest shows <b>Expected</b>. Anything else is still accepted and flagged <b>Not on manifest</b> for the office.
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-light">Outgoing · send queue</div>
          <div className="ml-auto text-[11px] text-secondary">{okCount} sent · {pendingCount} pending · {failCount} failed</div>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white">
          {history.map((h) => {
            const status = h.syncStatus || 'pending';
            const bg = status === 'ok' ? 'rgba(22,163,74,.12)' : status === 'failed' ? 'rgba(220,38,38,.12)' : 'rgba(255,122,0,.14)';
            const color = status === 'ok' ? '#15803D' : status === 'failed' ? '#B91C1C' : '#C2410C';
            const boxes = h.parcels.reduce((a, p) => a + p.boxes, 0);
            return (
              <div key={h.doc} className="flex items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] p-[11px_12px] last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs font-bold">{h.doc}</div>
                  <div className="truncate text-[10.5px] text-secondary">{h.carrier} · {h.parcels.length} parcels · {boxes} boxes</div>
                  {status === 'failed' && h.syncError && (
                    <div className="truncate text-[10px] font-medium text-[#B91C1C]">{h.syncError}</div>
                  )}
                </div>
                <div className="flex-none rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-[.05em]" style={{ background: bg, color }}>
                  {status === 'ok' ? 'sent' : status}
                </div>
                {status === 'failed' && (
                  <button onClick={() => retrySync(h.doc)} className="h-8 flex-none rounded-[9px] border border-[rgba(148,163,184,.35)] bg-white px-2.5 text-[11px] font-bold text-ink">
                    Retry
                  </button>
                )}
              </div>
            );
          })}
          <button onClick={syncNow} className="flex min-h-[50px] w-full items-center justify-center gap-2 bg-primary text-sm font-extrabold text-white">
            <RefreshCw size={17} strokeWidth={2} /> {syncing ? 'Sending…' : 'Sync now'}
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.1em] text-light">Endpoints</div>
        <div className="overflow-hidden rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="border-b border-[rgba(148,163,184,.15)] p-[11px_12px] last:border-b-0">
              <div className="flex items-center gap-2">
                <div
                  className="flex-none rounded-md px-1.5 py-1 font-mono text-[9.5px] font-extrabold"
                  style={{ background: e.method === 'GET' ? 'rgba(31,111,235,.12)' : 'rgba(22,163,74,.12)', color: e.method === 'GET' ? '#1F6FEB' : '#15803D' }}
                >
                  {e.method}
                </div>
                <div className="min-w-0 truncate font-mono text-[11.5px] font-bold">{e.path}</div>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-secondary">{e.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.1em] text-light">Session payload</div>
        <pre className="overflow-x-auto whitespace-pre rounded-[14px] bg-ink p-[13px] font-mono text-[10.5px] leading-relaxed text-[#E2E8F0]">{PAYLOAD_SAMPLE}</pre>
      </div>
    </div>
  );
}

// WMS App backend — validates the scanner key, resolves its country, and
// writes only into that country's own schema (wh_it / wh_fr / wh_de).
// No table here is ever reachable by the app's own credentials — this
// function is the only thing holding the service_role key.
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ALLOWED_COUNTRIES = ["IT", "FR", "DE"];

// The app runs inside a Capacitor WebView, which enforces normal browser
// CORS rules on every cross-origin fetch — same as a website would. Without
// these headers (and without answering the OPTIONS preflight a JSON POST
// triggers), the browser blocks the request before it ever leaves the
// phone: no error surfaces server-side, nothing shows up in logs, and
// last_used_at on the scanner key never moves. That silent failure is
// exactly what every real-device test hit.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Best-effort real client IP for the login audit trail below — Supabase
// Edge Functions run behind Cloudflare, which sets this header itself (not
// forwardable/spoofable by the caller), so it's the one to trust first.
// x-forwarded-for can carry a comma-separated chain if there's another
// proxy in front; the first entry is the original client.
function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

async function resolveCountry(req: Request): Promise<{ country: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key) return null;
  const keyHash = await sha256Hex(key);
  const { data, error } = await supabase
    .schema("admin")
    .from("scanner_keys")
    .select("country, active")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  supabase.schema("admin").from("scanner_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", keyHash).then(() => {});
  return { country: data.country };
}

Deno.serve(async (req: Request) => {
  // Preflight — the browser sends this ahead of the real POST/GET whenever
  // the request carries an Authorization/Content-Type header cross-origin.
  // Must be answered with no auth check at all (the preflight itself never
  // carries the app's Authorization header).
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Strip the function name prefix so routing matches the app's existing
  // paths exactly (/warehouse/sessions, /warehouse/manifest, ...).
  const path = url.pathname.replace(/^\/wms-api/, "") || "/";

  const auth = await resolveCountry(req);
  if (!auth) return json({ error: "invalid or unregistered scanner key" }, 401);
  const country = auth.country.toLowerCase();
  if (!ALLOWED_COUNTRIES.includes(auth.country)) return json({ error: "unknown country" }, 500);
  const schema = `wh_${country}`;

  try {
    // GET /admin/badge-country/{badgeId} — looks up which country a badge
    // belongs to, so the app can log an operator straight into the right
    // country with no manual picker. Authenticated the same way as every
    // other route (a valid per-country scanner key), but deliberately
    // ignores which country that key resolves to — any of the three keys
    // works here, since a badge's country isn't known yet at login time.
    // Note: this means a leaked key now also grants read access to the
    // *whole* cross-country badge roster (badge id -> country code), not
    // just its own country's data — a minor widening of the "a leaked key
    // only exposes one country" story. Acceptable: read-only, no PII beyond
    // a badge id and a country code.
    const badgeCountryMatch = path.match(/^\/admin\/badge-country\/([^/]+)$/);
    if (req.method === "GET" && badgeCountryMatch) {
      const badgeId = decodeURIComponent(badgeCountryMatch[1]);
      const { data, error } = await supabase
        .schema("admin")
        .from("badge_countries")
        .select("country, label")
        .eq("badge_id", badgeId)
        .eq("active", true)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "not found" }, 404);
      // `label` is the operator's name as registered against this badge —
      // the app uses it directly rather than ever asking the operator to
      // type their own name in, keeping badge login scan-only end to end.
      return json({ country: data.country, label: data.label || null });
    }

    // POST /admin/login-event — records a successful badge login for the
    // audit trail (Settings › Login history). `ip`/`logged_in_at` are
    // filled in here from the request itself, never trusted from the
    // client. Fire-and-forget from the app's side — a failure here must
    // never block or fail an actual login.
    if (req.method === "POST" && path === "/admin/login-event") {
      const body = await req.json().catch(() => ({}));
      const badgeId = String(body?.badgeId || "").trim();
      if (!badgeId) return json({ error: "badgeId required" }, 400);
      const { error } = await supabase.schema("admin").from("login_events").insert({
        badge_id: badgeId,
        operator_name: body?.operatorName || null,
        country: body?.country || null,
        ip: clientIp(req),
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // GET /admin/login-events?limit=100 — recent badge logins for this
    // country, newest first, for the Settings screen's login history.
    if (req.method === "GET" && path === "/admin/login-events") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 300);
      const { data, error } = await supabase
        .schema("admin")
        .from("login_events")
        .select("badge_id, operator_name, country, ip, logged_in_at")
        .eq("country", auth.country)
        .order("logged_in_at", { ascending: false })
        .limit(limit);
      if (error) return json({ error: error.message }, 500);
      return json({
        events: (data || []).map((e) => ({
          badgeId: e.badge_id,
          operatorName: e.operator_name,
          country: e.country,
          ip: e.ip,
          loggedInAtIso: e.logged_in_at,
        })),
      });
    }

    // POST /warehouse/next-doc-number — reserves the next progressive
    // document number for this country+direction *before* the app builds
    // and prints the handover PDF, so the number on the printed/archived
    // document always matches the one this row gets. Without reserving it
    // up front, the app would show a locally-generated placeholder that
    // could drift from the database's real counter (e.g. after a reinstall
    // resets the local counter, or a second operator/device is mid-session
    // at the same time) — the database number was always correct, but the
    // printed one wasn't guaranteed to match it.
    //
    // `kind: "ddt"` reserves from the separate DDT series instead — its own
    // per-country numbering that restarts each year ("DDT 209-OUT/2026"), which
    // is how delivery notes are numbered and how the prep center's own
    // documents read. A session shipping two shipments reserves two numbers.
    if (req.method === "POST" && path === "/warehouse/next-doc-number") {
      const body = await req.json().catch(() => ({}));
      if (body.kind === "ddt") {
        const { data: ddtDoc, error: ddtErr } = await supabase
          .schema("admin")
          .rpc("next_ddt_number", { p_country: auth.country });
        if (ddtErr) return json({ error: ddtErr.message }, 500);
        return json({ document: ddtDoc });
      }
      const { data: doc, error: docErr } = await supabase
        .schema("admin")
        .rpc("next_doc_number", { p_country: auth.country, p_direction: body.direction });
      if (docErr) return json({ error: docErr.message }, 500);
      return json({ document: doc });
    }

    // GET /warehouse/drivers — this country's remembered driver profiles
    // (name, company, plate), shared across every device/operator logged
    // into it — so a driver's details survive an app reinstall and show up
    // the same way on any phone, not just the one they were first typed on.
    if (req.method === "GET" && path === "/warehouse/drivers") {
      const { data, error } = await supabase
        .schema(schema)
        .from("driver_profiles")
        .select("name, courier_company, plate, last_used_at")
        .order("last_used_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({
        drivers: (data || []).map((d) => ({
          name: d.name,
          courierCompany: d.courier_company,
          plate: d.plate,
          lastUsedAt: d.last_used_at,
        })),
      });
    }

    // POST /warehouse/drivers — upsert one driver profile, keyed
    // case-insensitively on name (matches the app's own local dedup rule).
    if (req.method === "POST" && path === "/warehouse/drivers") {
      const body = await req.json();
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "name is required" }, 400);
      const { error } = await supabase
        .schema(schema)
        .from("driver_profiles")
        .upsert(
          {
            name,
            courier_company: body.courierCompany ?? null,
            plate: body.plate ?? null,
            last_used_at: body.lastUsedAt ? new Date(body.lastUsedAt).toISOString() : new Date().toISOString(),
          },
          { onConflict: "name_lower" },
        );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // GET /warehouse/sessions?days=30 — every session this country's
    // database has for the requested window, so History/Documents show the
    // same list on any device logged into this country, not just what
    // that one phone happened to create — and the doc numbers on display
    // are visibly the real, server-assigned, country-wide progressive
    // sequence. Deliberately excludes the archived PDF (fetched separately,
    // on demand, via the existing /warehouse/sessions/{doc}/pdf route) and
    // damage photos — both can be large, and this list is meant to stay
    // fast for a 30-day pull on every login.
    if (req.method === "GET" && path === "/warehouse/sessions") {
      const days = Number(url.searchParams.get("days")) || 30;
      const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
      const { data: sessionsData, error: sessErr } = await supabase
        .schema(schema)
        .from("sessions")
        .select("id, doc, direction, carrier, driver_name, driver_plate, operator, closed_at")
        .gte("closed_at", sinceIso)
        .order("closed_at", { ascending: false });
      if (sessErr) return json({ error: sessErr.message }, 500);
      const ids = (sessionsData || []).map((s) => s.id);
      const parcelsBySession: Record<string, any[]> = {};
      if (ids.length) {
        const { data: parcelsData, error: parcelErr } = await supabase
          .schema(schema)
          .from("parcels")
          .select("session_id, scan_order, tracking, boxes, expected, damage_type, no_code, created_at")
          .in("session_id", ids)
          .order("scan_order", { ascending: true });
        if (parcelErr) return json({ error: parcelErr.message }, 500);
        for (const p of parcelsData || []) {
          (parcelsBySession[p.session_id] ||= []).push(p);
        }
      }
      // The delivery notes issued for each session, so History shows them on
      // any device rather than only on the phone that printed them — a DDT
      // travels with the goods and is the document anyone asking later wants.
      // Summary only: the stored PDF and the signature are large, and both are
      // fetched on demand through /warehouse/ddt/{doc}/pdf.
      const ddtsBySession: Record<string, any[]> = {};
      if (ids.length) {
        const { data: ddtData, error: ddtErr } = await supabase
          .schema(schema)
          .from("ddt")
          .select("id, doc, session_id, shipment_id, fba_id, created_at")
          .in("session_id", ids)
          .order("created_at", { ascending: true });
        if (ddtErr) return json({ error: ddtErr.message }, 500);
        const ddtIds = (ddtData || []).map((d) => d.id);
        const boxesByDdt: Record<string, number> = {};
        if (ddtIds.length) {
          const { data: lineData, error: lineErr } = await supabase
            .schema(schema)
            .from("ddt_lines")
            .select("ddt_id, boxes")
            .in("ddt_id", ddtIds);
          if (lineErr) return json({ error: lineErr.message }, 500);
          for (const l of lineData || []) {
            boxesByDdt[l.ddt_id] = (boxesByDdt[l.ddt_id] || 0) + (l.boxes || 1);
          }
        }
        for (const d of ddtData || []) {
          (ddtsBySession[d.session_id] ||= []).push({
            number: d.doc,
            shipmentId: d.shipment_id,
            fbaId: d.fba_id,
            boxes: boxesByDdt[d.id] || 0,
            createdAtIso: d.created_at,
          });
        }
      }
      const sessions = (sessionsData || []).map((s) => ({
        doc: s.doc,
        direction: s.direction,
        carrier: s.carrier,
        driverName: s.driver_name,
        plate: s.driver_plate,
        operator: s.operator,
        closedAtIso: s.closed_at,
        parcels: (parcelsBySession[s.id] || []).map((p) => ({
          code: p.tracking,
          boxes: p.boxes,
          expected: p.expected,
          damage: p.damage_type,
          noCode: p.no_code,
          createdAtIso: p.created_at,
        })),
        ddtSummaries: ddtsBySession[s.id] || [],
      }));
      return json({ sessions });
    }

    // GET /warehouse/carriers — this country's carrier list, each with an
    // optional tracking-code prefix rule the app enforces at scan time.
    if (req.method === "GET" && path === "/warehouse/carriers") {
      const { data, error } = await supabase
        .schema(schema)
        .from("carriers")
        .select("name, pattern")
        .order("name", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ carriers: data || [] });
    }

    // POST /warehouse/carriers — add a new carrier or update an existing
    // one's rule, keyed case-insensitively on name.
    if (req.method === "POST" && path === "/warehouse/carriers") {
      const body = await req.json();
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "name is required" }, 400);
      const pattern = body.pattern ? String(body.pattern).trim().toUpperCase() : null;
      const { error } = await supabase
        .schema(schema)
        .from("carriers")
        .upsert({ name, pattern: pattern || null }, { onConflict: "name_lower" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // POST /warehouse/sessions — confirmed handover, header + parcels.
    if (req.method === "POST" && path === "/warehouse/sessions") {
      const body = await req.json();
      // Use the number the app already reserved via /next-doc-number when
      // present (the normal path) — only call next_doc_number here as a
      // fallback for a session that never got to reserve one (e.g. it was
      // built while offline), so a document is never rejected outright for
      // missing a pre-reserved number.
      let doc = body.document;
      if (!doc) {
        const { data: freshDoc, error: docErr } = await supabase
          .schema("admin")
          .rpc("next_doc_number", { p_country: auth.country, p_direction: body.direction });
        if (docErr) return json({ error: docErr.message }, 500);
        doc = freshDoc;
      }

      const { data: session, error: sessErr } = await supabase
        .schema(schema)
        .from("sessions")
        .insert({
          doc,
          direction: body.direction,
          carrier: body.carrier,
          driver_name: body.driver?.name ?? null,
          driver_plate: body.driver?.plate ?? null,
          operator: body.operator,
          closed_at: body.closed_at,
          signature: body.signature ?? null,
          pdf: body.pdf ?? null,
        })
        .select("id")
        .single();
      if (sessErr) return json({ error: sessErr.message }, 500);

      const parcels = (body.parcels || []).map((p: any, i: number) => ({
        session_id: session.id,
        scan_order: i + 1,
        tracking: p.tracking,
        boxes: p.boxes ?? 1,
        expected: p.expected ?? null,
        damage_type: p.damage?.type ?? null,
        damage_photo: p.damage?.photo ?? null,
        no_code: p.no_code?.flagged ?? false,
        no_code_note: p.no_code?.note ?? null,
        no_code_photo: p.no_code?.photo ?? null,
      }));
      if (parcels.length) {
        const { error: parcelErr } = await supabase.schema(schema).from("parcels").insert(parcels);
        if (parcelErr) return json({ error: parcelErr.message }, 500);
      }
      return json({ ok: true, document: doc });
    }

    // POST /warehouse/ddt — the outbound delivery notes for one session.
    //
    // A session produces one DDT per shipment, each listing only the trackings
    // actually scanned in that session. Written as an upsert on
    // (session_id, shipment_id) so re-syncing a session that already synced
    // updates its documents instead of creating a second set — the app retries
    // this call whenever a push failed, and a duplicated legal document is a
    // far worse outcome than a wasted write.
    //
    // The upsert REPLACES the row: the app is the source of truth for a DDT and
    // always sends the complete document. A caller that sent a partial one would
    // blank out the driver and signature on a document that has already been
    // signed, so send everything or send nothing.
    if (req.method === "POST" && path === "/warehouse/ddt") {
      const body = await req.json();
      const sessionDoc = String(body.document || "");
      if (!sessionDoc) return json({ error: "document is required" }, 400);

      const { data: session, error: findErr } = await supabase
        .schema(schema)
        .from("sessions")
        .select("id")
        .eq("doc", sessionDoc)
        .maybeSingle();
      if (findErr) return json({ error: findErr.message }, 500);
      if (!session) return json({ error: "unknown session document" }, 404);

      const saved: string[] = [];
      for (const d of body.ddts || []) {
        if (!d.shipment_id) return json({ error: "shipment_id is required on every DDT" }, 400);
        const { data: row, error: ddtErr } = await supabase
          .schema(schema)
          .from("ddt")
          .upsert(
            {
              doc: d.doc,
              session_id: session.id,
              shipment_id: String(d.shipment_id),
              fba_id: d.fba_id ?? null,
              driver_name: d.driver?.name ?? null,
              driver_plate: d.driver?.plate ?? null,
              driver_company: d.driver?.company ?? null,
              signature: d.signature ?? null,
              // Kept verbatim: a DDT is a legal transport document, so what the
              // prep center actually told us has to stay reconstructable.
              fields: d.fields ?? null,
              pdf: d.pdf ?? null,
            },
            { onConflict: "session_id,shipment_id" },
          )
          .select("id, doc")
          .single();
        if (ddtErr) return json({ error: ddtErr.message }, 500);

        // Replace the lines rather than appending, so a re-sync of a corrected
        // session does not leave the old tracking list behind next to the new.
        const { error: delErr } = await supabase.schema(schema).from("ddt_lines").delete().eq("ddt_id", row.id);
        if (delErr) return json({ error: delErr.message }, 500);
        const lines = (d.lines || []).map((l: any) => ({
          ddt_id: row.id,
          tracking: l.tracking,
          boxes: l.boxes ?? 1,
          condition: l.condition ?? null,
        }));
        if (lines.length) {
          const { error: lineErr } = await supabase.schema(schema).from("ddt_lines").insert(lines);
          if (lineErr) return json({ error: lineErr.message }, 500);
        }
        saved.push(row.doc);
      }
      return json({ ok: true, documents: saved });
    }

    // GET /warehouse/manifest?date=today — expected tracking IDs, this
    // country's list only.
    if (req.method === "GET" && path === "/warehouse/manifest") {
      const dateParam = url.searchParams.get("date");
      const date = !dateParam || dateParam === "today" ? new Date().toISOString().slice(0, 10) : dateParam;
      const { data, error } = await supabase.schema(schema).from("manifest_codes").select("tracking").eq("expected_date", date);
      if (error) return json({ error: error.message }, 500);
      return json({ tracking_ids: (data || []).map((r) => r.tracking) });
    }

    // POST /warehouse/parcels/{tracking}/damage — standalone damage push
    // (session push already carries damage too; this is the earlier,
    // immediate one fired the moment damage is recorded).
    const damageMatch = path.match(/^\/warehouse\/parcels\/([^/]+)\/damage$/);
    if (req.method === "POST" && damageMatch) {
      const tracking = decodeURIComponent(damageMatch[1]);
      const body = await req.json();
      const { error } = await supabase
        .schema(schema)
        .from("parcels")
        .update({ damage_type: body.type ?? null, damage_photo: body.photo ?? null })
        .eq("tracking", tracking);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // GET /warehouse/sessions/{doc}/pdf — the archived PDF for a document,
    // as raw binary (not JSON) so the app's fetchArchivedPdf can read it
    // straight into a Blob.
    const pdfMatch = path.match(/^\/warehouse\/sessions\/([^/]+)\/pdf$/);
    if (req.method === "GET" && pdfMatch) {
      const doc = decodeURIComponent(pdfMatch[1]);
      const { data, error } = await supabase.schema(schema).from("sessions").select("pdf").eq("doc", doc).maybeSingle();
      if (error || !data?.pdf) return json({ error: "not found" }, 404);
      const base64 = data.pdf.split(",")[1] || data.pdf;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { "Content-Type": "application/pdf", ...CORS_HEADERS } });
    }

    // GET /warehouse/ddt/{doc}/pdf — the archived delivery note, same shape as
    // the session PDF above, so a note issued on one phone can be reprinted
    // from any other. The document number carries a slash ("DDT 12-OUT/2026"),
    // so it arrives percent-encoded.
    const ddtPdfMatch = path.match(/^\/warehouse\/ddt\/(.+)\/pdf$/);
    if (req.method === "GET" && ddtPdfMatch) {
      const doc = decodeURIComponent(ddtPdfMatch[1]);
      const { data, error } = await supabase.schema(schema).from("ddt").select("pdf").eq("doc", doc).maybeSingle();
      if (error || !data?.pdf) return json({ error: "not found" }, 404);
      const base64 = data.pdf.split(",")[1] || data.pdf;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { "Content-Type": "application/pdf", ...CORS_HEADERS } });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
});

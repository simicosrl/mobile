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
    // POST /warehouse/next-doc-number — reserves the next progressive
    // document number for this country+direction *before* the app builds
    // and prints the handover PDF, so the number on the printed/archived
    // document always matches the one this row gets. Without reserving it
    // up front, the app would show a locally-generated placeholder that
    // could drift from the database's real counter (e.g. after a reinstall
    // resets the local counter, or a second operator/device is mid-session
    // at the same time) — the database number was always correct, but the
    // printed one wasn't guaranteed to match it.
    if (req.method === "POST" && path === "/warehouse/next-doc-number") {
      const body = await req.json().catch(() => ({}));
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
      }));
      if (parcels.length) {
        const { error: parcelErr } = await supabase.schema(schema).from("parcels").insert(parcels);
        if (parcelErr) return json({ error: parcelErr.message }, 500);
      }
      return json({ ok: true, document: doc });
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

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
});

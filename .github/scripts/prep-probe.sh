#!/usr/bin/env bash
# Ask the Prep-Center's function what routes it actually has.
#
# It answers 404 for an unknown route and 200 for one it serves, so a sweep
# separates the two. Read-only: every request here is a GET.
#
#   prep-probe.sh <base-url> [tracking-id]
# The key comes from PREP_API_KEY in the environment.
set -u
BASE="${1:?base url required}"; BASE="${BASE%/}"
TRACKING="${2:-}"
KEY="${PREP_API_KEY:-}"

AUTH=()
if [ -n "$KEY" ]; then
  AUTH=(-H "Authorization: Bearer ${KEY}")
  echo "Probing with a key."
else
  echo "Probing with no key — everything will be 401."
fi
echo "Base: $BASE"
echo

shape() {
  python3 -c '
import json,sys
try: d=json.load(open("/tmp/pb"))
except Exception:
    t=open("/tmp/pb",encoding="utf-8",errors="replace").read()[:120]
    print("        not json: "+t.replace("\n"," ")); raise SystemExit
def s(v,depth=0):
    if depth>2: return "..."
    if isinstance(v,dict): return "{"+", ".join("%s: %s"%(k,s(x,depth+1)) for k,x in list(v.items())[:14])+"}"
    if isinstance(v,list): return "[%d x %s]"%(len(v), s(v[0],depth+1) if v else "-")
    return type(v).__name__
print("        "+s(d)[:500])' 2>/dev/null || true
}

echo "=== routes that are NOT 404 ==="
found=0
for p in "" / /warehouse /warehouse/manifest "/warehouse/manifest?date=today" \
         /warehouse/shipments /warehouse/shipping /warehouse/shippings /warehouse/sessions \
         /warehouse/outbound /warehouse/inbound /warehouse/parcels /warehouse/boxes \
         /warehouse/orders /warehouse/products /warehouse/skus /warehouse/inventory \
         /warehouse/fba /warehouse/plans /warehouse/pack-groups /warehouse/packgroups \
         /warehouse/ddt /warehouse/documents /warehouse/labels /warehouse/drivers \
         /warehouse/carriers /warehouse/next-doc-number \
         /shipments /shipping /shippings /outbound /inbound /parcels /boxes \
         /orders /products /inventory /fba /plans /manifest /tracking /trackings \
         /api /api/shipments /v1 /v1/shipments /admin /admin/health /health /status; do
  code=$(curl -sS -m 20 -o /tmp/pb -w '%{http_code}' "$BASE$p" "${AUTH[@]}" -H 'Origin: https://localhost' 2>/dev/null || echo 000)
  if [ "$code" != "404" ]; then
    echo "  $code  GET ${p:-/}"
    shape
    found=$((found+1))
  fi
done
echo "  ($found routes answered something other than 404)"

echo
echo "=== full shape of the manifest response ==="
curl -sS -m 20 -o /tmp/pm "$BASE/warehouse/manifest?date=today" "${AUTH[@]}" -H 'Origin: https://localhost' 2>/dev/null || true
python3 -c '
import json
try: d=json.load(open("/tmp/pm"))
except Exception as e: print("  could not read:",e); raise SystemExit
print("  keys:",list(d.keys()))
for k,v in d.items():
    if isinstance(v,list):
        print("  %s: list of %d, element type %s"%(k,len(v),type(v[0]).__name__ if v else "-"))
        if v and isinstance(v[0],dict): print("     element keys:",list(v[0].keys()))
    else:
        print("  %s: %s"%(k,type(v).__name__))' 2>/dev/null || echo "  (unreadable)"

if [ -n "$TRACKING" ]; then
  echo
  echo "=== does the manifest know the tracking asked about? ==="
  python3 -c '
import json,sys
ids=(json.load(open("/tmp/pm")).get("tracking_ids") or [])
t=sys.argv[1]
print("  %d ids, %s present: %s" % (len(ids), t, "YES" if t in ids else "no"))' "$TRACKING" 2>/dev/null || echo "  (unreadable)"
fi

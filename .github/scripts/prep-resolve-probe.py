#!/usr/bin/env python3
"""Ask the Prep-Center's new resolve endpoint what it really answers.

The container this repo is developed in cannot reach supabase.co, so this runs
on a GitHub runner and commits its findings back. That means the findings end up
in version control, so this script prints the *shape* of the answer — field
names, types, list lengths — and never the values. A shipment record is full of
tracking numbers, customer names and addresses, and none of that belongs in a
git history.

    prep-resolve-probe.py <base-url>
Key from PREP_API_KEY.
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip('/')
KEY = os.environ.get('PREP_API_KEY', '')

# They said POST /warehouse/shipments/resolve. The app currently asks for
# /shipments/resolve. Try both rather than assume which one is live — the
# difference is the whole feature working or every box coming back unknown.
CANDIDATES = ['/warehouse/shipments/resolve', '/shipments/resolve']


def call(method, path, body=None, key=KEY, extra=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Origin', 'https://localhost')
    if key:
        req.add_header('Authorization', 'Bearer ' + key)
    for k, v in (extra or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', 'replace')
    except Exception as e:                                   # noqa: BLE001
        return 0, {}, 'transport error: %s' % e


def schema(v, depth=0, indent='  '):
    """Field names and types only. Never a value."""
    pad = indent * (depth + 1)
    if isinstance(v, dict):
        if not v:
            return '{}'
        out = ['{']
        for k, x in v.items():
            out.append('%s%s: %s' % (pad, k, schema(x, depth + 1, indent)))
        out.append(indent * depth + '}')
        return '\n'.join(out)
    if isinstance(v, list):
        if not v:
            return 'list(empty)'
        # Merge the keys of every element so an optional field is not missed
        # just because the first record happens not to carry it.
        if all(isinstance(e, dict) for e in v):
            merged = {}
            for e in v:
                for k, x in e.items():
                    if k not in merged or merged[k] is None:
                        merged[k] = x
            return 'list(%d) of %s' % (len(v), schema(merged, depth, indent))
        return 'list(%d) of %s' % (len(v), type(v[0]).__name__)
    if v is None:
        return 'null'
    return type(v).__name__


print('Base: %s' % BASE)
print('Key : %s' % ('present' if KEY else 'MISSING — everything will be 401'))
print()

# ---------------------------------------------------------------- real inputs
print('=== tracking IDs to ask about (from their own manifest) ===')
status, _, text = call('GET', '/warehouse/manifest')
ids = []
try:
    ids = json.loads(text).get('tracking_ids') or []
except Exception:                                            # noqa: BLE001
    pass
print('  GET /warehouse/manifest -> %s, %d ids' % (status, len(ids)))
sample = ids[:5]
if not sample:
    print('  no ids to probe with — stopping')
    sys.exit(0)
print('  probing with the first %d (not printed)' % len(sample))
print()

# ------------------------------------------------------------------- the route
print('=== which resolve path is live ===')
live = None
for path in CANDIDATES:
    status, _, text = call('POST', path, {'trackings': sample})
    note = ''
    if status == 200:
        try:
            body = json.loads(text)
            n = len(body.get('shipments', body) if isinstance(body, dict) else body)
            note = '  (%d shipment record(s))' % n
        except Exception:                                    # noqa: BLE001
            note = '  (200 but not JSON)'
    print('  %s  POST %s%s' % (status, path, note))
    if status == 200 and live is None:
        live = (path, text)
print()

if not live:
    print('No resolve path answered 200. Nothing more to report.')
    sys.exit(0)

path, text = live
print('=== shape of the answer from %s ===' % path)
try:
    print('  ' + schema(json.loads(text)))
except Exception as e:                                       # noqa: BLE001
    print('  could not parse: %s' % e)
print()

# ------------------------------------------------- the things the DDT depends on
print('=== the three things a DDT depends on ===')
try:
    body = json.loads(text)
    shipments = body.get('shipments', body) if isinstance(body, dict) else body
    if not isinstance(shipments, list):
        shipments = []
    boxkey = None
    for cand in ('boxes', 'parcels', 'packages', 'cartons'):
        if shipments and cand in (shipments[0] or {}):
            boxkey = cand
            break
    print('  shipment records          : %d' % len(shipments))
    print('  per-box list field        : %s' % (boxkey or 'NOT FOUND'))
    boxes = [b for s in shipments for b in (s.get(boxkey) or [])] if boxkey else []
    print('  boxes described           : %d' % len(boxes))
    with_contents = [b for b in boxes
                     if any(b.get(k) for k in ('contents', 'items', 'lines', 'products'))]
    print('  boxes with contents       : %d of %d' % (len(with_contents), len(boxes)))
    with_weight = [b for b in boxes
                   if b.get('weightKg') is not None or b.get('weight') is not None
                   or b.get('weight_kg') is not None]
    print('  boxes with a weight       : %d of %d' % (len(with_weight), len(boxes)))
    covered = set()
    for b in boxes:
        for k in ('tracking', 'trackingId', 'trackingNumber', 'carrierTracking'):
            if b.get(k):
                covered.add(str(b[k]))
    print('  of the %d asked about, resolved: %d' % (len(sample), len(covered & set(sample))))
    idkeys = [k for k in ('shipmentId', 'shipment_id', 'id', 'shippingId')
              if shipments and shipments[0].get(k)]
    print('  shipment id field         : %s' % (idkeys[0] if idkeys else 'NOT FOUND'))
except Exception as e:                                       # noqa: BLE001
    print('  could not analyse: %s' % e)
print()

# ------------------------------------------------------------------ the guards
print('=== auth and CORS ===')
status, _, _ = call('POST', path, {'trackings': sample}, key='')
print('  no key                    -> %s  (401 expected)' % status)
status, hdrs, _ = call('OPTIONS', path, extra={
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type',
})
print('  OPTIONS preflight         -> %s' % status)
for h in ('Access-Control-Allow-Origin', 'Access-Control-Allow-Headers',
          'Access-Control-Allow-Methods'):
    got = next((v for k, v in hdrs.items() if k.lower() == h.lower()), None)
    print('    %-31s %s' % (h + ':', got if got else 'MISSING'))

print()
print('=== unknown tracking ===')
status, _, text = call('POST', path, {'trackings': ['ZZZ-DOES-NOT-EXIST-0000']})
try:
    body = json.loads(text)
    shipments = body.get('shipments', body) if isinstance(body, dict) else body
    print('  %s, %d shipment(s) returned (0 expected)'
          % (status, len(shipments) if isinstance(shipments, list) else -1))
except Exception:                                            # noqa: BLE001
    print('  %s, unparseable' % status)

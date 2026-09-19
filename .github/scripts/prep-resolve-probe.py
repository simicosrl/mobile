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


# ---------------------------------------------------------------------------
# If real tracking IDs resolve to nothing, the endpoint is answering but not
# finding — and there are only two explanations worth separating: we are naming
# the request field differently than it expects, or it genuinely holds no
# association for these parcels. Guessing wrong here costs a release, so ask.
def count(resp_text):
    try:
        b = json.loads(resp_text)
        s = b.get('shipments', b) if isinstance(b, dict) else b
        return len(s) if isinstance(s, list) else -1
    except Exception:                                        # noqa: BLE001
        return -1


print()
print('=== is the request field named what we think? ===')
SHAPES = [
    ('{"trackings": [...]}', {'trackings': sample}),
    ('{"tracking_ids": [...]}', {'tracking_ids': sample}),
    ('{"trackingIds": [...]}', {'trackingIds': sample}),
    ('{"codes": [...]}', {'codes': sample}),
    ('{"tracking": "one"}', {'tracking': sample[0]}),
    ('bare array [...]', sample),
]
for label, body in SHAPES:
    st, _, tx = call('POST', path, body)
    print('  %s  %-26s -> %s shipment(s)' % (st, label, count(tx)))

print()
print('=== does anything in their whole manifest resolve? ===')
st, _, tx = call('POST', path, {'trackings': ids})
print('  asked about all %d manifest ids -> %s, %s shipment(s)' % (len(ids), st, count(tx)))
try:
    b = json.loads(tx)
    if isinstance(b, dict):
        print('  top-level keys in the answer: %s' % list(b.keys()))
        for k, v in b.items():
            if k != 'shipments':
                print('    %s: %s' % (k, schema(v)))
except Exception:                                            # noqa: BLE001
    print('  unparseable')


# ---------------------------------------------------------------------------
# Asking about one particular parcel, without writing its number down.
#
# A tracking number identifies a real customer's goods and this report is
# committed to the repo, so the ID is never passed in or printed. What is passed
# is its SHA-256: the probe hashes each manifest entry, finds the one that
# matches, and reports the verdict. A hash answers "is this one resolvable?"
# without the file ever carrying the answer to "which parcel is it?".
ASK_FILE = '.github/prep-probe-ask.txt'
wanted = []
try:
    for line in open(ASK_FILE, encoding='utf-8'):
        line = line.split('#')[0].strip().lower()
        if len(line) == 64:
            wanted.append(line)
except FileNotFoundError:
    pass

if wanted:
    import hashlib
    print()
    print('=== the specific parcels asked about ===')
    by_hash = {}
    for t in ids:
        by_hash[hashlib.sha256(t.encode()).hexdigest()] = t
        by_hash[hashlib.sha256(t.upper().encode()).hexdigest()] = t
        by_hash[hashlib.sha256(t.lower().encode()).hexdigest()] = t
    for h in wanted:
        tid = by_hash.get(h)
        label = h[:12] + '…'
        if not tid:
            print('  %s  NOT in the manifest at all' % label)
            continue
        print('  %s  in the manifest' % label)
        st, _, tx = call('POST', path, {'trackings': [tid]})
        try:
            b = json.loads(tx)
            ship = (b.get('shipments') if isinstance(b, dict) else b) or []
        except Exception:                                    # noqa: BLE001
            ship = []
        if not ship:
            print('             resolve -> %s, no shipment' % st)
            continue
        s0 = ship[0]
        bx = (s0.get('boxes') or [{}])[0]
        print('             resolve -> %s, shipmentId present: %s, fbaId present: %s'
              % (st, bool(s0.get('shipmentId')), bool(s0.get('fbaId'))))
        print('             weightKg: %s, contents lines: %d'
              % (bx.get('weightKg'), len(bx.get('contents') or [])))
        qty = sum(int(c.get('qty') or 0) for c in (bx.get('contents') or []))
        print('             total units in the box: %d' % qty)
        # Scanners are not always consistent about case; if their lookup is
        # case-sensitive, a lower-case scan would silently resolve to nothing.
        for variant, name in ((tid.lower(), 'lower-case'), (tid.upper(), 'upper-case')):
            if variant == tid:
                continue
            st2, _, tx2 = call('POST', path, {'trackings': [variant]})
            try:
                b2 = json.loads(tx2)
                n2 = len((b2.get('shipments') if isinstance(b2, dict) else b2) or [])
            except Exception:                                # noqa: BLE001
                n2 = -1
            print('             same ID as %s -> %d shipment(s)' % (name, n2))


# ---------------------------------------------------------------------------
# A delivery note has to state where the goods are going. Their answer carries a
# destination object with the right key names, but on every shipment seen so far
# every value inside it is an empty string — so the address box prints blank on
# a legal transport document. Measure it across everything they can resolve,
# rather than reporting from the handful we happened to look at.
print()
print('=== are the address blocks actually filled? ===')
st, _, tx = call('POST', path, {'trackings': ids})
try:
    body = json.loads(tx)
    ships = (body.get('shipments') if isinstance(body, dict) else body) or []
except Exception:                                            # noqa: BLE001
    ships = []


def filled(obj):
    """An address counts as filled if any field in it has a non-empty value."""
    if not isinstance(obj, dict):
        return bool(obj)
    return any(str(v or '').strip() for v in obj.values())


print('  shipments examined: %d' % len(ships))
for block in ('pickup', 'customer', 'destination'):
    have = sum(1 for s in ships if filled(s.get(block)))
    present = sum(1 for s in ships if s.get(block) is not None)
    print('  %-12s present on %3d, filled on %3d' % (block + ':', present, have))
empties = [s for s in ships if s.get('destination') is not None and not filled(s.get('destination'))]
if empties:
    print('  destination is an empty shell on %d of %d shipments' % (len(empties), len(ships)))
    print('  its keys are: %s' % sorted((empties[0].get('destination') or {}).keys()))
# Which other fields a delivery note wants are missing outright.
for f in ('carrier', 'amazonReference', 'reason', 'goodsDescription', 'legalNote', 'packingGroup'):
    have = sum(1 for s in ships if str(s.get(f) or '').strip())
    print('  %-18s on %3d of %3d' % (f + ':', have, len(ships)))


# ---------------------------------------------------------------------------
# When most shipments carry a destination and a sizeable minority do not, the
# useful question is no longer "how many" but "which ones". If the empty set is
# distinguishable by some other field, their developer has a pointer instead of
# a count.

# A shipment record can cover several boxes, so "134 shipments" says nothing
# about how many of the listed IDs a scan will actually place. Every ID that
# does not come back is a box the operator has to type a reference for by hand.
print()
print('=== how many listed IDs actually resolve? ===')
covered_all = set()
for sh in ships:
    for bx in (sh.get('boxes') or []):
        for k in ('tracking', 'trackingId', 'trackingNumber', 'carrierTracking'):
            if bx.get(k):
                covered_all.add(str(bx[k]))
asked = set(ids)
print('  listed in the manifest : %d' % len(asked))
print('  resolvable             : %d' % len(asked & covered_all))
print('  listed but unresolvable: %d' % len(asked - covered_all))
print('  (boxes described in total: %d, across %d shipments)'
      % (sum(len(sh.get('boxes') or []) for sh in ships), len(ships)))

print()
print('=== what tells the empty-destination shipments apart? ===')
have = [s for s in ships if filled(s.get('destination'))]
gone = [s for s in ships if s.get('destination') is not None and not filled(s.get('destination'))]
print('  with a destination: %d      without: %d' % (len(have), len(gone)))


def pct(group, f):
    if not group:
        return '   -'
    n = sum(1 for s in group if str(s.get(f) or '').strip())
    return '%3d/%-3d' % (n, len(group))


def boxpct(group, f):
    if not group:
        return '   -'
    n = sum(1 for s in group for b in (s.get('boxes') or []) if b.get(f) not in (None, ''))
    t = sum(len(s.get('boxes') or []) for s in group)
    return '%3d/%-3d' % (n, t)


print('  %-20s %-10s %-10s' % ('field', 'with dest', 'without'))
for f in ('carrier', 'fbaId', 'shipmentId', 'prepAt', 'packingGroup', 'reason', 'legalNote'):
    print('  %-20s %-10s %-10s' % (f, pct(have, f), pct(gone, f)))
print('  %-20s %-10s %-10s' % ('boxes[].weightKg', boxpct(have, 'weightKg'), boxpct(gone, 'weightKg')))
print('  %-20s %-10s %-10s' % ('boxes[].contents', boxpct(have, 'contents'), boxpct(gone, 'contents')))
# The shape of a filled destination, so they can see what a good one looks like.
if have:
    d = have[0].get('destination') or {}
    print('  a filled destination has values for: %s'
          % sorted(k for k, v in d.items() if str(v or '').strip()))

print()
print('=== does it say why nothing matched? ===')
st, hdrs, tx = call('POST', path, {'trackings': sample})
print('  status %s, body length %d' % (st, len(tx)))
print('  content-type: %s'
      % next((v for k, v in hdrs.items() if k.lower() == 'content-type'), '?'))
# The body is a schema-only concern unless it is an error string, which carries
# no customer data and is the most useful thing here.
try:
    b = json.loads(tx)
    if isinstance(b, dict) and not b.get('shipments'):
        for k in ('error', 'message', 'detail', 'reason', 'warning', 'excluded', 'unknown'):
            if k in b:
                print('  %s: %s' % (k, json.dumps(b[k])[:300]))
except Exception:                                            # noqa: BLE001
    print('  body was not JSON')

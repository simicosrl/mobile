# Prep-Center → WMS App: the DDT resolve endpoint

What the warehouse app needs from the prep center in order to produce a DDT
when a driver collects goods. One endpoint. Everything else is already built.

The app calls this through the **Prep-Center connection already configured in
Settings → API** (base URL + key). No new credential.

---

## The call

```
POST  {base URL}/shipments/resolve
Authorization: Bearer {the key from Settings → API}
Content-Type: application/json

{ "trackings": ["1Z999AA10123456784", "1Z999AA10123456785"] }
```

The app sends the tracking IDs it does not already know. A shipment answered
once is cached for the rest of the session, so a shipment of 200 boxes costs
one call, not 200.

## The answer

```jsonc
{
  "shipments": [
    {
      "shipmentId": "SH-1",                    // required — the shipping this belongs to
      "fbaId": "FBA15MGNXYBV",                 // Amazon inbound plan
      "amazonReference": "4WNCW3ZN",

      "carrier": "UPS",
      "reason": "Delivery of goods to Amazon FBA on behalf of third party",
      "goodsDescription": "Box",
      "prepAt": "16/09/2026, 13:59",
      "packingGroup": "Pack group 1",
      "legalNote": "The goods are owned by the customer. …",

      "pickup":      { "name": "Simico", "street": "Via Acquasparsa 37", "postalCode": "24060",
                       "city": "Grone", "province": "BG", "country": "IT",
                       "phone": "+3903519775012", "email": "info@simico.srl" },
      "customer":    { "name": "G&S Commerce GmbH", "street": "Ferdinand Rauneggergasse 32",
                       "postalCode": "9020", "city": "Klagenfurt", "country": "AT",
                       "vat": "ATU81467958" },
      "destination": { "name": "Amazon Services FCO8/IFC8", "street": "Via della Mola Saracena",
                       "postalCode": "00065", "city": "Fiano Romano", "province": "Lazio",
                       "country": "IT" },

      "boxes": [
        {
          "tracking": "1Z999AA10123456784",
          "weightKg": 18.1,
          "contents": [
            { "description": "Corsair MP700 PRO SE 4TB", "sku": "AMZIT_1309_B0D7J41STC_DE",
              "asin": "B0D7J41STC", "qty": 2 }
          ]
        }
      ]
    }
  ]
}
```

A tracking ID you do not recognise: just leave it out. The app flags it to the
operator and keeps it off every DDT rather than guessing.

### Field names

The adapter accepts common variants (`shipment_id`/`id`/`shippingId`,
`trackingNumber`/`trackingId`, `quantity`/`units`, `zip`/`cap`, and so on), and
addresses may be an object, an array of lines, or a newline-separated string.
So the names above are a guide, not a demand — but `shipmentId`, `boxes[].tracking`
and `boxes[].contents` have to be there in some form.

---

## Three things that decide whether this works

### 1. Contents **per box**, not per shipment

This is the one that matters most.

A DDT describes the boxes that actually left. A driver often takes 3 boxes out
of a 200-box shipment, and tomorrow's driver takes 4 more — each collection is
its own DDT, listing its own goods. Shipment-level or pack-group totals cannot
answer "what was in *these three* boxes", so a DDT built from them would state
quantities that never left the building. On a transport document that is a false
declaration, not a rounding error.

If your API can only return totals per pack group, say so — we would have to
change what the DDT claims, and that is a decision for you, not for the app.

### 2. Weight per box

Same reason. The DDT prints the total weight of the boxes collected. If a box's
weight is missing, send no field rather than `0` — the app prints an empty
weight instead of "0.00 kg", which would also be a false statement.

### 3. CORS headers

The app runs inside an Android WebView, so the browser enforces CORS on this
call. Without these the request never leaves the phone and fails silently:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Allow-Methods: POST, OPTIONS
```

and the `OPTIONS` preflight must be answered `204` with the same headers,
**without** an auth check (the preflight carries no Authorization header).

If you cannot add these, tell us — we move the call to our own backend instead,
which also takes the key off the phone. That is the better arrangement anyway;
it just needs the credentials to live on our server.

---

## What the app does with it

- Groups the scanned boxes by `shipmentId`.
- One DDT per shipping, listing only the boxes scanned in that session.
- Sums identical SKUs across those boxes for the products table.
- Adds a **DRIVER SIGNATURE** block — name, company, plate, collection time and
  the signature captured on the phone — which is the reason the app generates
  the document rather than printing yours.
- Numbers it from its own yearly series: `DDT 1-OUT/2026`, `DDT 2-OUT/2026`, …
- Stores the response verbatim next to the document, so what we printed stays
  reconstructable if a value is ever disputed.

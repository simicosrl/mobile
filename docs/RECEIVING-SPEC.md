# Recepție marfă în inventar + login cu operatorii Prep-Center — specificație

Stare: **analiză aprobată, nimic construit.** Constrângere fixă: **softul
Prep-Center nu se modifică** (fără migrări, funcții, rute sau câmpuri noi).
Aplicația se adaptează la ce există deja acolo.

## Decizii luate

| Subiect | Decizie |
|---|---|
| Sursa operatorilor | Conturile de staff din Prep-Center (`profiles`) |
| Login | Email + parolă Prep-Center prima dată pe telefon, apoi **badge** (fără PIN) |
| Cine folosește aplicația | Permisiunea Prep-Center **`warehouse`** (adminii au acces complet) |
| Unitate de numărare | Bucăți |
| Produs care nu e în comandă | **Blocat** — nu intră în inventar; se poate lăsa o notă `issue` |
| Bucăți peste cantitatea anunțată | Permise, cu confirmare, linia marcată roșu (ca în adminul web) |
| Când crește stocul | La fiecare confirmare (ca în adminul web); „Închide recepția” schimbă doar starea comenzii |
| Raft | „Raft activ” scanat; fără raft → raftul implicit al clientului (automat, ca în web) |
| Țări | IT, FR, DE |
| Legătura cu Inbound | După predarea de la curier: buton „Începe recepția” |
| Excluse din v1 | Retururi Amazon (`import_source = amazon_removal_order`), loturi/expirări editabile |

## 1. Login cu operatorii Prep-Center

Aplicația devine un client Supabase al Prep-Center (URL + cheia anon, publice,
aceleași ca în portalul web), autentificat ca operatorul respectiv. RLS și
permisiunile de admin se aplică exact ca pe web.

**Prima logare pe un telefon**
1. Email + parolă → sesiune Supabase Auth Prep-Center.
2. Citește `profiles` pentru utilizatorul logat: `first_name`, `last_name`,
   `email`, `country`, `allowed_markets`, `is_admin`, `is_limited_admin`,
   `is_operator`, `operator_permissions`.
3. Acces permis dacă e admin sau `operator_permissions` conține `warehouse`.
4. Verificarea de rețea a depozitului (`verify-staff-warehouse-network`) se
   apelează prin HTTP nativ (CORS-ul ei acceptă doar originile portalului).
   Dacă răspunde „nu” → accesul e refuzat. Nu ocolim regula, doar CORS-ul.
5. „Scanează badge-ul tău” → badge-ul se leagă de cont.

**Logările următoare:** scanezi badge-ul → se reia sesiunea salvată pe telefon
a acelui operator. Badge necunoscut pe telefon → email + parolă o dată.
Sesiune expirată/revocată → parola din nou.

**MFA:** dacă operatorul are autentificator activat în Prep-Center, aplicația
cere codul de 6 cifre la prima logare, exact ca site-ul.

**Unde se țin datele** (implementat în etapa 1)
- Pe telefon (IndexedDB): `prepOperators` — sesiunile salvate pe operator
  (refresh token, nu parola) și ultimul profil citit; `prepBadgeLinks` —
  `badge → utilizator Prep-Center`. Legătura e per telefon, ca și sesiunea:
  pe un telefon nou, badge-ul cere parola o dată.
- Țara se ia din `profiles.country`; admin cu mai multe piețe
  (`allowed_markets`) alege țara la începutul turei.
- Offline: tura pornește din profilul salvat (ca la badge-ul vechi), cu
  excepția conturilor restrânse la rețeaua depozitului, care sunt blocate.

**Ce se schimbă în aplicație**
- Numele vine din Prep-Center (nu se mai editează în Settings).
- Documentele: `operator` = numele din Prep-Center; badge-ul rămâne ca referință.
- Conexiunea WMS (`DEFAULT_SCANNER_KEYS[country]`) se alege după țara din profil.
- Jurnalul de login înregistrează și contul Prep-Center.
- Tranziție: login-ul vechi pe badge rămâne câteva săptămâni ca rezervă.

## 2. Fluxul de recepție (operator)

1. **Home → „Recepție marfă”** (vizibil doar cu permisiunea `warehouse`).
2. **Scanare tracking** → căutare în `receiving_shipments` pe `tracking_id` și
   `tracking_ids`, filtrat pe `warehouse_country` = țara turei, fără cele
   anulate/excluse. 1 rezultat → deschide; mai multe → listă; 0 → căutare
   manuală după client / referință. Plus lista „Recepții deschise”.
3. **Comanda:** client, colete, `receiving_shipments.notes` + discuția din
   `receiving_shipment_notes`, progres bucăți primite / așteptate.
4. **Card produs:** poză (`image_url` pe item sau pe `stock_item`), denumire,
   EAN, ASIN, FNSKU/SKU, notele pe linie (`receiving_shipment_notes.line_id`),
   `primit / așteptat`, culoare de stare.
5. **Scanare cod produs:** potrivire pe `ean`, `ean_asin`, `fnsku`, `asin`,
   `sku`, `stock_item.ean` (normalizare ca `validateEAN` din Prep-Center) → +1.
   Mai multe linii cu același cod → alegere. Cod care nu e în comandă → blocat,
   opțiune „Raportează” (notă `kind = 'issue'`, opțional cu poză).
6. **Manual:** tap pe card → tastatură numerică, „Tot (N)”, −/+.
7. **Raft activ:** se scanează codul din `storage_places.code`; rămâne activ
   până la alt raft. Afișat permanent sus.
8. **Finalizare:** rezumat (complete, lipsuri, în plus, rapoarte) → „Închide
   recepția”.

## 3. Ce face aplicația pe server la fiecare confirmare

Reproduce `applyReceivedUnits` din `src/components/admin/AdminReceiving.jsx`
(Prep-Center), în aceeași ordine. Codul stă izolat în `src/lib/prepReceiving.js`.

1. Recitește linia `receiving_items` (valoarea curentă, nu cea din ecran).
2. Calculează noua țintă `received_units` și câmpurile derivate:
   `is_received`, `quantity_to_stock`, `send_to_fba`, `fba_qty`,
   `remaining_action` (aceleași reguli ca în web, inclusiv `fba_mode = 'full'`).
3. **Stoc:** `functions/v1/receiving-side-effects` cu `inventory_adjustments`
   și `target_quantity` = noua cantitate. E idempotent (țintă, nu diferență) →
   retrimiterea e sigură. Răspunsul dă `stock_item_id` și `quantity_moved`.
4. **Istoric depozit:** dacă `quantity_moved ≠ 0`, aceeași mișcare ca
   `logWarehouseMovement` (`inbound`, `source_ref_type = 'receiving_shipment'`).
5. **Linia din comandă:** update `receiving_items` (plus `received_by` doar la
   prima recepție a liniei; `stock_item_id`).
6. **Loturi:** RPC `ensure_receiving_shipment_default_lots`.
7. **Raft:** cu raft activ → RPC `warehouse_place_product` (sursa = recepția,
   cheie de idempotență); fără → RPC `warehouse_auto_place_received_stock` pe
   raftul implicit al clientului (dacă are).

**Finalizare:** aceeași cale ca `markShipmentFullyReceived` →
`receiving_shipments.status = 'received'` + efectele existente (emailuri).

## 4. Fără rețea și concurență

- Pe fiecare linie se ține doar **ultima țintă** în coadă (IndexedDB). La
  revenirea rețelei se trimit pașii 1–7; pasul de stoc e idempotent.
- Linia arată „nesincronizat” până trec toți pașii.
- Doi operatori pe aceeași linie: recitirea dinaintea scrierii reduce riscul;
  ultimul care scrie câștigă (ca în web). Aplicația afișează cine a mai lucrat
  recent pe recepție (`receiving_item_events`).

## 5. Riscuri

- **Logica există în două locuri** (web + aplicație). La fiecare release:
  diff pe fișierele de recepție din Prep-Center (`AdminReceiving.jsx`,
  `supabase.js`, `receiving-side-effects`) și test comparativ: același produs
  recepționat din web și din aplicație → stoc, mișcări, rafturi identice.
- **Pașii nu sunt o singură tranzacție** (la fel ca în web) — de aceea
  ordinea: stocul primul, apoi restul, cu reluare.
- **Badge fără PIN:** cine are badge-ul intră ca acel operator (ca acum).
- **Telefon pierdut:** operatorul își schimbă parola în Prep-Center → sesiunea
  salvată nu mai merge.
- **Profiluri FR/DE** trebuie să aibă `country` corect în Prep-Center.

## 6. Structură în aplicație

- `src/lib/prepAuth.js` — login Supabase Prep-Center, sesiuni pe operator, profil, permisiuni.
- `src/lib/prepReceiving.js` — căutări + pașii 1–7 + finalizare.
- `src/state/ReceivingContext.jsx` — starea recepției (separat de `AppContext`).
- `src/screens/ReceivingStart.jsx`, `src/screens/ReceivingOrder.jsx`.
- Componente: `ProductLineCard`, `QtySheet`, `LocationChip`, `BlockedItemSheet`, `ReceivingSummary`.
- Câmpul de scanare (hardware + cameră) extras din `Scan.jsx` într-un hook comun.

## 7. Etape

1. ✅ Login cu operatorii Prep-Center + badge (badge-ul vechi ca rezervă) —
   `src/lib/prepAuth.js`, `AppContext` (`loginWithBadge`, `prepSignIn`,
   `prepVerifyMfa`, `prepChooseCountry`, `forgetPrepOperator`), `BadgeLogin.jsx`,
   Settings › Operator profile.
2. ✅ Recepție: căutare după tracking + vizualizare comandă (doar citire) —
   `src/lib/prepReceiving.js` (căutarea adminului `search_admin_receiving_shipments_v2`,
   `receiving_shipments` + `receiving_items` + `stock_items`, `receiving_shipment_notes`),
   `src/state/ReceivingContext.jsx`, `ReceivingStart.jsx`, `ReceivingOrder.jsx`,
   `src/hooks/useScanInput.js`. Scanarea unui produs doar evidențiază linia.
3. ✅ Confirmare cantități (scanare + manual), stoc la fiecare confirmare, coadă offline —
   `src/lib/prepReceivingSave.js` (pașii lui `applyReceivedUnits`, în aceeași ordine),
   coada din `ReceivingContext.jsx` (o intrare pe linie: delta scanată → țintă absolută
   salvată înainte de scriere, deci retrimiterea nu dublează), `ReceivingOrder.jsx`
   (scanare +1, confirmare peste cantitatea anunțată, alegere când un cod e pe mai
   multe linii, tastatură numerică, „Undo last”, stare salvare pe fiecare card).
4. ✅ Raft activ — scanarea unei etichete de raft (sau „Set shelf”) îl face activ;
   raftul e verificat ca pe web (`storage_places` din țară, `storage_place_claims`:
   liber sau al acestui client). Bucățile noi merg pe el prin
   `warehouse_set_product_placement` (ca `saveInlinePlacementDraft`); fără raft activ,
   pe raftul implicit al clientului (`warehouse_auto_place_received_stock`).
   Coada ține minte raftul fiecărei scanări. La scădere (Undo / cantitate mai mică),
   bucățile se scot întâi de pe raftul lor (pasul pe care web-ul îl cere manual);
   dacă stau pe alt raft, scăderea e refuzată cu mesaj. Cardul arată rafturile
   pe care stă produsul.
5. ✅ Finalizare + „Începe recepția” din Inbound —
   „Finish reception”: așteaptă salvarea cozii, arată complet / lipsă / în plus și
   propune o notă despre diferențe, salvată automat la „Finish” (fără buton separat) în firul recepției exact ca din web
   (`receiving_shipment_notes`, `sender_type: 'admin'`; în admin apare la „Notes with client”; clientul o vede). Starea
   recepției n-o schimbă aplicația: Prep-Center o derivă din linii (totul complet →
   Received; altfel rămâne Partial). Bulk „Mark as received” din web NU e folosit —
   ar trece în stoc cantitatea anunțată, nu cea primită.
   După predarea de la curier (Inbound): „Receive these parcels into stock” caută
   recepțiile tuturor coletelor (potrivire exactă); una se deschide direct, mai
   multe sunt listate, coletele fără recepție sunt numite.
6. ✅ Retragerea login-ului vechi pe badge — scos din aplicație (butonul de rezervă,
   căutarea țării după badge, numele editabil). O tură veche rămasă deschisă pe un
   telefon nu se mai reia: se cere badge-ul. Tabelul `admin.badge_countries` și ruta
   `/admin/badge-country` din `wms-api` rămân pe server, pentru APK-urile vechi încă
   instalate; pot fi scoase după ce toate telefoanele au update-ul.

## 8. Stock check și mutări între rafturi

Home → **Stock check** (`src/screens/StockCheck.jsx`, date în `src/lib/prepWarehouse.js`).
Un singur câmp de scanare: un cod de raft din depozitul țării deschide **raftul**,
orice alt cod caută **produsul**.

- **Produs** — câte un card pe client (același EAN poate fi al mai multor clienți;
  fiecare `stock_items` e al unui singur client). Avertisment sus când codul e la
  mai mulți clienți; fiecare client are culoarea lui. Pe card: stoc în țară
  (`prep_qty_by_country[țară]`, altfel `qty` — ca pe web), pe rafturi, nepus pe raft,
  rafturile (`warehouse_locations` legate prin `stock_item_id`, cu lot/expirare) și
  recepțiile deschise care îl mai așteaptă (inclusiv anunțate fără produs în stoc).
- **Raft** — ce e pe el, grupat pe client, starea raftului (liber / ocupat /
  blocat / de verificat gol).
- **Move** (un rând), **Move everything** (tot raftul), **Quick move** (scanezi
  bucățile luate, apoi raftul de destinație) — `warehouse_relocate_product`, ca
  „Relocate” din Warehouse pe web; stocul nu se schimbă. Destinația e verificată
  pentru fiecare client implicat; serverul verifică din nou (capacitate, depozit).
- **↩︎ Recv.** — înapoi în zona de recepție: `warehouse_unassign_product`.
- **Put on shelf** — bucăți în stoc, pe niciun raft: puse pe raft prin recepțiile
  prin care au intrat (`warehouse_set_product_placement` cu recepția ca sursă, ca
  în AdminReceiving), cea mai veche întâi; serverul verifică limita recepționată,
  stocul nu se schimbă. Maximul = min(nepuse pe raft, loc rămas în recepții).
  Stocul care n-a intrat printr-o recepție nu se poate pune pe raft din aplicație
  (pe web singura cale, „place product”, adaugă stoc nou).
- Fiecare confirmare are cheia ei de idempotență, păstrată la reîncercare.
  Mutările cer conexiune (nu intră în coada offline).

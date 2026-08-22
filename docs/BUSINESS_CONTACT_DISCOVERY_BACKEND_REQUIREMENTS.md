# Business Contact Discovery — Backend Requirements

Everything the backend needs for the **Import business contacts** tab in Contacts → Import.

The Angular front end is **built and running against these exact shapes**, served today by an
in-memory mock. Match them and the UI needs no changes. Nothing here exists on the API yet — all
four endpoints 404, and the client says so honestly rather than faking results.

Base path suggestion: `/api/v1/business-discovery`. Response envelope, paging, auth and error shapes
are unchanged from the rest of the API.

---

## 0. What this feature does

A user picks a point on a map, a radius and a business category. The backend asks a places provider
what businesses are there. The user reviews the results, then either downloads a spreadsheet for the
existing file-import flow, or imports the selected businesses directly.

```
Location + radius + category  →  provider search  →  review  →  CSV download
                                                            └→  direct import
```

**The provider is entirely the backend's concern.** The browser never holds a provider key, never
calls a provider, and does not know which provider is in use. That is not a preference — a key
shipped to the browser is a key published to every customer, and provider calls are billable.

---

## 1. Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/business-discovery/categories` | Categories the provider supports |
| GET | `/business-discovery/places?query=` | Geocode typed text → candidate points |
| GET | `/business-discovery/places/reverse?latitude=&longitude=` | Name a dropped pin |
| POST | `/business-discovery/search` | One page of businesses near a point |
| POST | `/business-discovery/import` | Import selected businesses as contacts |

All five require a valid bearer token. All five are tenant-scoped from the token — see §6.

There is **no export endpoint**: the CSV is generated in the browser. See §5.

### 1.1 `GET /business-discovery/categories`

Returns the category list for the picker.

```jsonc
[
  { "id": "barber",     "label": "Barber",        "group": "Personal care" },
  { "id": "restaurant", "label": "Restaurant",    "group": "Food & drink" }
]
```

| Field | Notes |
| --- | --- |
| `id` | Sent back on search. Provider-neutral slug — **not** a raw provider enum, so the provider can change without breaking saved UI state |
| `label` | Shown to the user |
| `group` | Optional. Used for grouping in the picker; safe to omit |

Cache this hard — it changes at the speed of provider releases, not user actions. The client keeps a
small built-in fallback list and uses it if this call fails, so a failure degrades to a slightly
stale picker rather than an unusable screen. **Do not** return an empty array to mean "no opinion";
the client will treat it as a real answer and keep its fallback.

### 1.2 `GET /business-discovery/places?query=`

Forward geocoding. The client debounces 350 ms and only calls with 3+ characters.

```jsonc
[
  {
    "id": "place_1",
    "label": "Gulberg, Lahore, Pakistan",
    "latitude": 31.5204,
    "longitude": 74.3587,
    "country": "Pakistan"
  }
]
```

`label` is what the user picks from, so it should be specific enough to disambiguate two places with
the same name. `country` fills the CSV's Country column — return the display name, or null.

### 1.3 `GET /business-discovery/places/reverse?latitude=&longitude=`

Reverse geocoding, for naming a pin the user dropped or a GPS fix. Same shape as one item above, or
`null` if nothing sensible is nearby. **`null` is a fine answer** — the client shows the pin without
a name and searches by coordinates, which is what actually matters.

### 1.4 `POST /business-discovery/search`

The main call.

```jsonc
{
  "latitude": 31.5204,
  "longitude": 74.3587,
  "radiusKm": 5,
  "category": "barber",
  "page": 1,
  "pageSize": 25
}
```

| Field | Validation |
| --- | --- |
| `latitude` | −90 … 90, required |
| `longitude` | −180 … 180, required |
| `radiusKm` | 1 … 50, required. **Enforce the ceiling server-side** — the client offers 1/2/5/10/20/50, but that list is convenience, not security |
| `category` | Must be a known category id |
| `page` | ≥ 1 |
| `pageSize` | 1 … 50. The client sends 25 |

`POST` rather than `GET` deliberately: the query is structured, and a billable search should not be
replayed by a prefetching browser or cached by an intermediary.

#### Response

```jsonc
{
  "items": [
    {
      "id": "provider-place-id",
      "name": "Elite Barber Shop",
      "phone": "+92 300 1234567",
      "address": "10 Main Boulevard, Gulberg",
      "latitude": 31.5211,
      "longitude": 74.3599,
      "category": "Barber",
      "website": "https://example.com",
      "rating": 4.3,
      "openingHours": "Mon–Sat, 10:00–20:00",
      "existsInContacts": false
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 42,
  "hasNextPage": true,
  "searchId": "srch_01H..."
}
```

**Every field except `id`, `name`, `latitude` and `longitude` may be `null`.** Return `null`, never
a placeholder — the UI renders only what is present, and a fabricated phone number would be
messaged by a campaign.

| Field | Notes |
| --- | --- |
| `id` | Provider id. **Must be stable across pages of one search**, because the client merges pages by id to avoid duplicate rows |
| `phone` | E.164 preferred. A business with no phone cannot become a contact — the client shows it, disables it, and excludes it from the CSV |
| `existsInContacts` | See §4. `null` means "not determined" and hides the badge |
| `total` | Total matches, not the page length. Drives "42 businesses found" |
| `hasNextPage` | Drives **Load more**. The client stops asking when false |
| `searchId` | Optional. Echoed back on import so you can correlate and rate-limit |

### 1.5 `POST /business-discovery/import`

```jsonc
{
  "businessIds": ["provider-place-id-1", "provider-place-id-2"],
  "searchId": "srch_01H...",
  "groupName": "Barber · Gulberg, Lahore"
}
```

**The client sends ids, not records.** This is deliberate and should stay that way: accepting
client-supplied business details would turn this into an unvalidated contact-creation endpoint that
bypasses the import pipeline. Resolve the ids against the cached search result (§7).

`groupName` is a group the imported contacts should join, created if it does not exist — the same
semantics as the `Groups` column in the file importer. May be `null`.

#### Response

```jsonc
{
  "imported": 17,
  "skipped": 4,
  "failed": 2,
  "failures": [
    {
      "businessId": "provider-place-id-9",
      "name": "Corner Barber",
      "reason": "The phone number could not be normalised to E.164."
    }
  ]
}
```

`imported + skipped + failed` must equal the number of ids sent — the UI shows all three and a
mismatch reads as lost data. `failures` may be empty; `reason` is shown verbatim to the user, so
write it for an operator, not a log.

---

## 2. Errors

Standard RFC 7807, as elsewhere. The client branches on these and shows purpose-written copy:

| Status | `errorCode` | Client shows |
| --- | --- | --- |
| 429 | `search_limit_reached` | "Business search limit reached. Please try again later." |
| 402 | `provider_quota_exceeded` | "Business search is temporarily unavailable on this workspace. Please contact support." |
| 422 | `radius_too_large` | Field-level validation message |
| 404 / 405 / 501 | — | "Business search is not available yet on this deployment." |
| other | — | `detail`, verbatim |

**Never put provider details in `detail`.** Not the provider name, not its error body, not quota
numbers. That text is rendered to the end user, and it is where infrastructure leaks.

---

## 3. Provider integration

The backend needs a places provider offering:

- **Nearby search by point + radius**, filtered by category
- **Phone numbers** — the single most important field. A provider that omits them makes this
  feature pointless, since a contact without a phone cannot be messaged
- **Geocoding and reverse geocoding** for §1.2 and §1.3
- Ideally address, website, rating and opening hours

Google Places, Foursquare and HERE all qualify. OpenStreetMap/Overpass is free but its phone-number
coverage is patchy and varies wildly by country — check coverage for your actual markets before
choosing it on price.

**Configuration:** provider key in server configuration or a secret store, never in source, never in
a response. The client has no provider-specific setting of any kind and needs none.

**Rate limits and cost.** Provider calls are billable per request, and this UI can generate them
quickly — a user changing the radius and re-searching four times is four charges. See §8.

**Caching.** Cache search results keyed on `(rounded lat, rounded lng, radiusKm, category, page)`.
Rounding coordinates to ~3 decimals (≈100 m) makes small pin nudges hit the same cache entry.
A 24-hour TTL is reasonable: businesses do not move often, and stale-by-a-day is far cheaper than
fresh-every-time. The cache also backs §7.

---

## 4. Duplicate detection

The client **does not** attempt this and should not be given the chance. It has no access to the
full contact list, cannot normalise phone numbers reliably, and a wrong answer in either direction
is costly: a false "already imported" silently drops a real prospect.

**Match on phone number, normalised to E.164, scoped to the tenant.** That is what the existing file
importer keys on, and consistency between the two paths matters more than cleverness — a business
the file importer would treat as a duplicate must be reported as a duplicate here.

Suggested additional signals, only where the phone is missing or ambiguous:

- Exact name match plus proximity (within ~100 m)
- Website domain match

Set `existsInContacts` accordingly, or `null` if you chose not to check — the badge and the
**New / Already imported** filters simply disappear rather than misleading.

On import, duplicates are **skipped, not merged and not duplicated**, and counted in `skipped`.

---

## 5. Excel / CSV export — handled entirely in Angular

**No endpoint required.** The client builds the file in the browser and saves it directly.

The existing importer accepts `.csv` and `.xlsx` (`ACCEPTED_IMPORT_EXTENSIONS`), so CSV is
sufficient and needs no library, no round trip and no new backend surface.

Columns are exactly the seven labels from `IMPORT_TARGET_FIELDS`, so the importer's own
`suggestedMapping` recognises every one without the user touching the mapping step:

```
Phone number, Full name, Email, Country, Status, Tags, Groups
```

Mapping applied: phone → `Phone number`, business name → `Full name`, category → `Tags`, search
location's country → `Country`, `Subscribed` → `Status`, and the group name → `Groups`. The file is
UTF-8 with a BOM so Excel opens accented names correctly. Businesses with no phone are omitted —
they would fail every row on import.

### The lossy part, worth a decision

**The contact import format has no field for address, website, rating or opening hours.** Those are
shown in the UI and are genuinely useful, but they cannot ride through the CSV path — inventing
columns for them would either be ignored or trip the importer's `UnsupportedColumn` row error.

So today: **the direct-import path can preserve business metadata and the CSV path cannot.** If you
want addresses and websites stored against imported contacts, that is a decision to make on the
import endpoint (§1.5), where you receive the full provider record and can map it wherever you like.
Tell us if the contact model gains fields for this and the CSV can carry them too.

---

## 6. Security and tenant isolation

```
Tenant (Admin)
   └── Employees
         └── Contacts
               └── Business imports
```

- **Tenant comes from the token, never the request.** No endpoint here accepts a tenant id, and none
  should be added. The client has no way to name a tenant and does not try.
- Contacts created by import belong to the caller's tenant. Duplicate detection queries only that
  tenant's contacts — a business already imported by another customer is **new** to this one.
- `searchId` and any cached result must be scoped to the tenant that created them, or one tenant
  could import another's search results by guessing an id.
- Validate every input server-side: coordinate ranges, radius ceiling, page size, category
  membership. The client validates too, but that is for the user's benefit, not yours.

### Permissions

The tab is currently gated client-side on the existing **`contacts.import`** permission, and the
`/contacts/import` route already enforces it via `permissionGuard` + `featureGuard` (module `crm`).

**We recommend adding a dedicated `contacts.business_import` permission.** Uploading a file the user
already has costs nothing; discovering businesses spends provider credits. Those are different
risks and deserve different grants — an employee trusted to import a spreadsheet is not necessarily
trusted to spend the workspace's search quota.

It is not used yet because a permission the backend does not issue would be held by nobody and would
hide the feature from everyone. Add it to the catalogue, grant it to Admins by default, and the
client switches in one line (`canDiscover` in `contact-import.component.ts`).

**Enforce it on all five endpoints regardless of what the UI does.** Hiding a tab is tidiness, not a
security boundary.

---

## 7. Resolving ids at import time

`POST /import` receives provider ids, so you need the search result to resolve them.

Recommended: persist each search's results server-side against the `searchId`, tenant-scoped, with a
short TTL (an hour is plenty — nobody reviews a search for longer). The import then reads from that
record. This also means the import does not re-hit the provider, which would otherwise double the
cost of every discovery.

If a `searchId` has expired, return `409` with a clear `detail` — the client shows it and the user
can search again. Do not silently re-query the provider; that is a surprise charge.

---

## 8. Cost and rate limiting

This feature can spend real money quickly, and it is worth being conservative from the start.

| Control | Suggested |
| --- | --- |
| Searches per user | 30/hour |
| Searches per tenant | 200/day |
| Max radius | 50 km, enforced server-side |
| Max `pageSize` | 50 |
| Max pages per search | Cap total results per search — 200 is generous for a review UI |
| Cache TTL | 24 h on search results (§3) |

When a limit is hit, return `429` with `search_limit_reached`. The client shows a purpose-written
message and stops rather than retrying, which is exactly what you want — a generic error would have
users hammer the button and burn more quota.

If the **provider's** quota is exhausted rather than the user's, return `402` with
`provider_quota_exceeded` so the distinction is visible in your metrics. The user-facing wording
differs too: one is "try later", the other is "contact support".

---

## 9. Map tiles — one thing to decide

The map itself is Leaflet, lazy-loaded (37.65 kB gzipped, in its own chunk — not the initial
bundle). It currently draws OpenStreetMap's public tiles.

**OSM's tile usage policy does not permit heavy commercial use**, so this is fine for development
and not fine at scale. Before launch, pick one:

1. A licensed tile provider (MapTiler, Stadia, Mapbox) with the **URL served from backend
   configuration**, so the key is never in the Angular bundle; or
2. A backend tile proxy that adds the key server-side.

The client already accepts `tileUrl` and `attribution` as inputs on `MapPickerComponent`, so
whichever you choose is a one-line wiring change. If you expose it as configuration, an endpoint
returning `{ tileUrl, attribution }` alongside the categories call would be the natural place.

---

## 10. What the front end already does

| Piece | File |
| --- | --- |
| Models, CSV builder, radius options | `core/models/business-discovery.model.ts` |
| API calls — the only place the API is touched | `core/services/business-discovery.service.ts` |
| Reusable map: pin, radius circle, markers | `shared/ui/map-picker/map-picker.component.ts` |
| The whole flow | `features/contacts/import/business-discovery/` |
| Tabs and permission gate | `features/contacts/import/contact-import.component.*` |

Behaviour worth matching or knowing about:

- Location search debounced 350 ms; geolocation **only** on an explicit click, never on load.
- Pages merged by `id`, so a business repeated across pages appears once.
- Selection is held as a set of ids and survives paging and filtering.
- **Select all** applies to what the current filter shows, and skips businesses with no phone.
- Businesses with no phone are shown, disabled, labelled, and excluded from both export paths.
- The review step states new vs existing counts and warns about anything being left out.
- Import is confirmed in a dialog naming the counts before anything is sent.

---

## 11. Verified

Against the mock, which reproduces the awkward cases on purpose — businesses with no phone, some
already in Contacts, and a deliberately failing slice on import:

- Search from `Gulberg, Lahore`, 5 km, Barber → **42 found**, 25 rendered, 26 map markers
  (25 results + the centre pin).
- **Select all** selected 23 of 25, correctly skipping the two without phone numbers, whose
  checkboxes are disabled.
- Filters partition exactly: All 25 = New 20 + Already imported 5.
- **Load more** brought the total to 42 rows with no duplicates and preserved the 23 selected.
- Review reported 18 new + 5 existing = 23 selected, with the derived group name.
- Import returned 17 imported + 4 skipped + 2 failed = 23, with the failure reasons listed.
- **CSV headers are an exact set match** with `IMPORT_TARGET_FIELDS` labels — no missing label, no
  column the importer does not know. Quotes and commas escape correctly
  (`"Smith, Jones & ""Co"""`), the BOM is present, and phone-less rows are dropped.
- The existing **Upload file** tab is unchanged: dropzone, template download and import history all
  behave as before, and history now follows that tab rather than showing on both.
- An **Employee without `contacts.import`** sees no nav entry, is redirected away from the route,
  and never sees the tab.
- No horizontal scroll at 375 px with the map open.

To exercise it without a backend, set `useMockApi: true` in `web/src/environments/environment.ts`.

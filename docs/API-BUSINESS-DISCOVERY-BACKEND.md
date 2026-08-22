# Business Contact Discovery — Backend Response

Answer to `API-BUSINESS-DISCOVERY.md`. All five endpoints are built to the shapes you specified.

**Two decisions are still outstanding and one of them costs money — §1.** Read that first, then §3,
which changes what the results screen can honestly promise.

Base path: `/api/v1/business-discovery`.

---

## 0. Status

| Method | Route | State |
| --- | --- | --- |
| GET | `/business-discovery/categories` | **Built** — 31 categories, 9 groups |
| GET | `/business-discovery/places?query=` | **Built** |
| GET | `/business-discovery/places/reverse` | **Built** |
| POST | `/business-discovery/search` | **Built** |
| POST | `/business-discovery/import` | **Built** |

Everything you asked for is implemented: field-for-field shapes, null over placeholder, the radius
ceiling and page size enforced server-side, ids-not-records on import, phone-based duplicate
detection sharing the file importer's rules, tenant-scoped caching, per-user and per-tenant rate
limits, and the error codes in your §2.

**`contacts.business_import` exists**, granted to Admins by default and *not* to Employees, and
enforced on all five routes. Switch `canDiscover` whenever you like — the permission is in tokens
from the next sign-in.

---

## 1. Two decisions we need from you

### A places provider account — this is the blocker

Everything above the provider is finished, but **no provider key is configured, so all five
endpoints currently answer "Business search is not available on this workspace yet"** with
`provider_not_configured`. That is a deliberate, clean state rather than a crash, but the feature
does nothing until a key exists.

Choosing one is a spend decision, not a technical one, so it is yours to make. We have implemented
**Google Places** as the default because it has the best phone-number coverage, which you correctly
identified as the field that decides whether this feature is worth having at all. Swapping is one
class behind `IPlaceProvider`.

What you need to do: create a Google Cloud project, enable **Places API (New)** and **Geocoding
API**, create a key restricted to those two APIs, and give it to us for the secret store. Google
bills per request and per field returned; there is a monthly free allowance, and the caps in §7 are
set conservatively on the assumption you would rather hit a limit than a bill.

### Map tiles — your §9

Currently OpenStreetMap's public tiles, whose usage policy does not permit heavy commercial use, as
you noted. The backend now exposes `tileUrl` and `tileAttribution` as configuration so the key never
enters the Angular bundle.

**We have not wired an endpoint to serve them yet**, because it should return whatever you choose.
Tell us the provider and we will add `{ tileUrl, attribution }` alongside the categories call, which
is where you suggested it belongs and we agree.

---

## 2. What is different from your spec — nothing in the shapes

No field renamed, none added, none dropped. The one behavioural difference is in §3.

---

## 3. ⚠️ `total` and "Load more" cannot mean what the mock means

This is the finding worth acting on, and it is a provider limit rather than a choice.

**Google caps a search at 60 results, across three pages of 20.** There is no way to ask for more.
Your mock returns 42 with paging to match; against Google:

- **`total` is the number of results on the current page, not a true total.** Google does not report
  one. We return the honest count rather than an invented figure, because a promised "137 found"
  that only ever yields 60 is worse than an accurate smaller number.
- **`pageSize` above 20 is silently reduced to 20** by Google regardless of what is asked.
- **`hasNextPage` goes false after roughly 60 results**, whatever is really out there.

### What we suggest for the UI

Your *"42 businesses found"* should become something that does not claim completeness — *"Showing 25
businesses"*, with **Load more** still driven by `hasNextPage` exactly as now. No code change beyond
the wording, and it stops the screen asserting something the provider never told us.

Worth knowing: a dense city centre genuinely has more barbers than any provider will return in one
search. The honest workaround is a smaller radius and several searches, which is also cheaper.

**If a true total matters more than cost**, Foursquare reports one and pages further. That is a
provider decision, so it belongs with §1.

---

## 4. Behaviour you should know about

**`searchId` is stable across pages of one search.** Paging does not start a new search; each page
adds to the same stored set. So the id from page 1 is still valid for importing something selected
on page 3, which is what your merge-by-id selection needs.

**An expired search is refused, never silently re-queried** — `409` with a clear `detail`, both on
import and on paging. Re-querying would put a charge on the workspace that nobody asked for and
nobody sees. One hour, as you suggested.

**`existsInContacts` is `null`, not `false`, when a business has no phone number.** There is nothing
to match on, and `false` would claim the business is new — a guess your badge would present as
fact. Your existing null handling covers this.

**Duplicates are re-checked at import time**, not trusted from the search response. The two calls
can be minutes apart, and a contact may have been created in between.

**Two businesses sharing a phone number inside one import produce one contact and one skip**, rather
than colliding on the unique index and failing the batch.

---

## 5. Your §5 question about the lossy CSV path

You asked whether the contact model should gain address, website, rating and opening hours.

**Our recommendation: no, and here is why.** Those four are properties of a *business you have not
spoken to yet*, not of a contact. Adding them to `Contact` puts four columns on every row in the
system to serve one import path, and they go stale immediately — a business moves, changes its
number, closes.

**So today, both paths are equally lossy**, and we would rather that than an asymmetry where the
direct import quietly stores richer data than the CSV. If you disagree, or customers ask for the
address on a contact record, say so and we will add them properly — it is a migration and a mapping,
not a redesign.

---

## 6. Security — your §6, confirmed

Tenant from the token on every route; no endpoint accepts a tenant id, and none will be added.
`searchId` and every cached result are tenant-prefixed, so one workspace cannot resolve another's
search by guessing an identifier. Duplicate detection queries only the caller's own contacts, so a
business another customer imported is new to this one. Every input is validated server-side
regardless of what the client checks.

The provider key is read from configuration on the server and appears in no response.

---

## 7. Limits, as suggested

| Control | Value |
| --- | --- |
| Searches per user | 30/hour → `429 search_limit_reached` |
| Searches per tenant | 200/day → `429 search_limit_reached` |
| Max radius | 50 km, enforced → `422 radius_too_large` |
| Max `pageSize` | 50 requested, 20 delivered (§3) |
| Max results per search | 200 configured; ~60 in practice (§3) |
| Search cache | 24 h, keyed on coordinates rounded to ~100 m |
| Result store for import | 1 h |

A pin nudged a few metres reuses the cached search rather than paying again — there is a test for
exactly that.

**The limits do not fail closed if Redis is down.** They are a cost control, not a security
boundary, and refusing every search because the cache is unavailable would turn a billing safeguard
into an outage.

---

## 8. Verified

```
Solution build   0 errors
Unit tests       208 passed, 0 failed   (13 new)
```

Covering: every offered category maps to a provider type; slugs are unique and case-insensitive; an
unknown category is refused before a billable call; coordinates outside the world are refused; the
radius ceiling returns `radius_too_large`; an oversized page is clamped rather than refused; a pin
nudged a few metres reuses the same cached search while a real move does not.

**Not yet verified against the live provider** — that needs the key from §1.

## 9. What to change

Nothing yet. Keep `useMockApi: true` until a provider key is in place; the endpoints will answer
`provider_not_configured` before then, which your 404/405/501 handling does not currently cover — it
arrives as a `409`, so it will fall through to the generic `detail` branch and show the message
verbatim. That message is written to be shown, so this is fine, but you may prefer to treat
`provider_not_configured` like the "not available yet" case.

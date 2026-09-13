# Exports & Business Discovery — Notes for the Backend

Response to the contacts-export findings, plus an audit of map-based business discovery. Everything
below was checked against source on both sides, not assumed.

---

## 1. Contacts export — one correction, one reprioritisation

### 1.1 The country column does round-trip today

You flagged "country exports as a display name while import expects an ISO code" as the most
valuable of the three. I traced it and I think that's overstated:

- Export writes `Countries.ToDisplayName(code)` → `CodeToName[code]` → `RegionInfo(code).EnglishName`.
- Import reads `Countries.ToStorageCode(name)` → `NameToCode[name]`, and `NameToCode` is built as
  **the exact inverse of `CodeToName`**, with `OrdinalIgnoreCase`.

So every known code survives a round trip. It fails only when:

1. the stored value was never a code (a legacy name, or `XX` from a bad import) — `ToDisplayName`
   returns it as-is and import then falls back to guessing from the phone number; or
2. export and import run on hosts with **different ICU data**, so the English names differ.

Still worth changing to ISO codes — it removes the ICU dependency from the round trip and costs
nothing — but it is a fragility, not a break.

### 1.2 The bare `\r` quoting miss is the one that can corrupt data

`\n` instead of `\r\n` is cosmetic for every parser in play, including our own importer. An
unquoted bare `\r` inside a name is not: some parsers treat it as a row break and shift every
following cell by a column. If you only fix one, fix that.

### 1.3 Selection export works on your side — the client was sending it wrong

I told the frontend owner that `ContactQuery` has no `Ids`. True, but the surviving endpoint takes
**`ContactExportQuery`, which adds `Ids`**. My mistake.

The actual bug was mine and older: the client sent `ids=a,b,c` as one value. With no comma-list
binder registered, that binds as a single element, `ParseIds` rejects it, and the export answers with
**a header-only file**. Fixed — the client now sends repeated keys (`ids=a&ids=b`), and a spec pins it.

**One hardening ask:** `ParseIds` silently drops ids it can't parse. If *all* of them fail, the
operator gets an empty file with no error. A `422` when a non-empty `Ids` parses to nothing would
turn that into something they can see.

### 1.4 The Swagger 500

A test that fails on duplicate route templates at startup would have caught it before it shipped.
Route collisions have now bitten this project three ways (`/templates/counts`,
`/campaigns/summary`, this).

---

## 2. Business discovery — is it complete?

**The flow is built end to end, but it cannot run against the real API today.** One configuration
gap blocks everything; the rest are correctness issues found along the way.

### 2.1 Blocking — no Places API key is configured

`GooglePlacesProvider.IsConfigured` is `false`: `Places:ApiKey` is not in user-secrets (only
`Smtp:Password` and the four `WhatsApp:*` entries are). So every discovery endpoint answers
`provider_not_configured`.

```bash
dotnet user-secrets set "Places:ApiKey" "<key>" --project src/Marketing.API
```

The key needs **Places API (New)** and **Geocoding API** enabled. The client now shows a specific
message for `provider_not_configured` instead of falling through to generic text.

### 2.2 Verified correct

| Check | Result |
| --- | --- |
| All 5 routes exist and match client paths | ✅ |
| Exported headers auto-map on import | ✅ — the suggester matches all seven: `phone number`, `full name`, `email`, `country`, `status`, `tags`, `groups` |
| File type | ✅ — import accepts `.csv` and `.xlsx` |
| Extra columns | ✅ — `UnsupportedColumn` is never raised, so unmapped columns are ignored |
| Result ceiling | ✅ — 200 per search, `hasNextPage` stops there |

### 2.3 Fixed on the client

**Permission mismatch.** Every endpoint requires `contacts.business_import`. The client gated the
tab on `contacts.import` and didn't have `contacts.business_import` in its catalogue at all — so a
user with import but not discovery saw the tab and hit a 403 on every call, and no admin could grant
the real permission from the UI. Now registered and used as the gate.

**The file and the direct import disagreed about phones.** Search returns `normalised ?? business.Phone`
— the raw provider number when it can't normalise. The CSV wrote that verbatim; file import doesn't
convert national numbers; so it imported fine and failed at send time, while direct import rejects
the same business. The CSV now applies the same rule: international kept, national expanded using
the search location's country, anything else left out and counted in the toast.

**Country is written as an ISO code** in the discovery CSV, for the reasons in §1.1.

**"All businesses" was only what had been paged in.** Export used the selection, and select-all only
covered loaded results. There's now **Load all results**, which walks the remaining pages one at a
time up to your 200 ceiling — sequential because each page is a billable call.

### 2.4 Asks

**A. Return a dialable phone separately from the display phone.** Falling back to the raw number is
right for the review screen, but it means the client has to re-derive "can this be imported" with
its own rules. A `phoneE164: string | null` beside `phone` would let both paths read the same answer
from the same place.

**B. Add `CountryCode` (ISO) to `PlaceSuggestionResponse`.** It only carries the display name. The
client maps that through its own 40-country list — a search outside those countries gets a blank
Country column, and national-format numbers there can't be expanded and are left out.

**C. Decide consent for discovered businesses — this one isn't technical.** Both paths mark them
`Subscribed`: the CSV writes it and `BusinessDiscoveryService` sets `ContactStatus.Subscribed`. These
businesses never opted in. Meta requires opt-in for business-initiated messages, and messaging
numbers that didn't agree to it is how a quality rating drops, then the messaging limit, then the
number. I haven't changed it on the client because it has to match the server and it's a product
decision — but it should be made deliberately, not inherited from a default.

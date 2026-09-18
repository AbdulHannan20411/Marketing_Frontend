# Location Search In Business Discovery — Broken, With Proof

**For the backend agent.** "Search location" in Import → Business discovery returns no suggestions.
Two separate causes, one yours and one in Google Cloud. Business search itself is fine — only
geocoding is dead.

---

## 1. Evidence

`Places:ApiKey` is set in user secrets and the API has been restarted since, so the key **is** loaded.
Calling Google directly with that same key:

```
GET https://maps.googleapis.com/maps/api/geocode/json?address=lahore&key=<key>
→ HTTP 200
  "status": "REQUEST_DENIED"
  "error_message": "You must enable Billing on the Google Cloud Project …"
  "results": []
```

```
POST https://places.googleapis.com/v1/places:searchText     (Places API, new)
→ HTTP 200, 3 real businesses returned
```

So: **Places API (new) works with this key. The legacy Geocoding API is denied.**
`GET /business-discovery/places` and `/places/reverse` both call Geocoding, so both return nothing.
`/business-discovery/search` calls Places and works.

## 2. The backend bug: HTTP 200 is not success for Geocoding

`GooglePlacesProvider.GeocodeAsync` and `ReverseGeocodeAsync` only branch on
`response.IsSuccessStatusCode`, then read `payload.Results`. The legacy Geocoding API reports
failures **in the body with HTTP 200**, so `REQUEST_DENIED`, `OVER_QUERY_LIMIT`,
`INVALID_REQUEST` and `ZERO_RESULTS` all arrive as "an empty list of results".

The endpoint therefore answered `200 []` — indistinguishable from "no such place" — and the client
could only render an empty dropdown. A misconfigured key looked exactly like a typo.

**Please read `status` and act on it** (the same call sites, `SendAsync` is fine as it is):

| Google `status` | Meaning | Suggested mapping |
| --- | --- | --- |
| `OK`, `ZERO_RESULTS` | genuinely nothing matched | empty list, as today |
| `REQUEST_DENIED` | key/billing/API not enabled | `BusinessRuleException("provider_not_configured", …)` + log the `error_message` |
| `OVER_QUERY_LIMIT` | quota | `ProviderQuotaException("provider_quota_exceeded", …)` |
| `INVALID_REQUEST`, `UNKNOWN_ERROR` | transient or a bug | `ExternalServiceException("Places", …, isTransient: true)` |

Log `error_message` server-side. It names the misconfiguration precisely and contains no key.

## 3. The fix that needs no billing change

The new Places API already works with this key, and the legacy Geocoding API is the only thing
refused. Two options, your call:

- **A — switch geocoding to Places API (new).** `POST places:searchText` for forward lookup (field
  mask `places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents`)
  and `places:searchNearby`, or reverse geocoding, for naming a pin. Same key, same host family as the
  search call that already works, and it removes the platform's last dependency on the legacy API.
  For a typeahead, `places:autocomplete` is cheaper than Text Search — but check its pricing and
  session-token rules before adopting it.
- **B — keep Geocoding and have billing enabled** on the Google Cloud project (an operator action,
  see §5). Smaller change, but the platform keeps a second Google API to keep enabled and funded.

Either way §2 should still be fixed: silently returning an empty list for a denied request is the
reason nobody could tell what was wrong.

**`PlaceSuggestion` / the endpoint contract does not need to change.** The client sends
`?query=` and expects `{ id, label, latitude, longitude, country, countryCode }`. Keep `label`
specific enough to tell two same-named places apart, and keep `countryCode` as ISO 3166-1 alpha-2 —
the CSV export and phone-number expansion both read it.

## 4. Client changes made alongside this note

1. **The search stream no longer dies on the first failure.** The error was reaching the subscriber,
   which completes the observable — so after one failed lookup the box ignored every later keystroke
   until the page was reloaded. The error is now caught inside `switchMap`. Worth knowing when you
   test: before this, one failure disabled the feature for the rest of the session.
2. **Every outcome is now visible:** "Searching…", the suggestion list, "No places match …", or
   "Location search is unavailable — click the map to drop a pin instead". Once §2 returns a real
   error code, that last message is what the user sees instead of nothing.
3. **The map jumps rather than flies** when a chosen place is off-screen (`setView` instead of
   `panTo`), so selecting a city on the other side of the country moves the pin immediately.
   Selecting a suggestion already re-centred the map and the radius circle; that part was working.

## 5. Operator action (not code)

In Google Cloud for project `542965309129`:

1. Enable **billing** on the project — the Geocoding API refuses without it, even inside the free
   monthly credit.
2. Confirm **Geocoding API** is enabled (Places API (new) already is, proven above).
3. Restrict the key to those two APIs, and to the server's IP if it is fixed. It is currently
   unrestricted, which is worth fixing regardless of this bug.

If option A is taken instead, step 1 and 2 can be skipped for this feature — but verify nothing else
still calls the legacy API first.

## 6. Questions

1. **Option A or B?** If A, the client needs no change at all.
2. **Autocomplete:** is a per-keystroke Places autocomplete acceptable cost-wise, or should the
   dropdown keep debouncing Text Search at 350 ms as it does now?
3. **Unconfigured deployments:** should `/business-discovery/places` answer `409
   provider_not_configured` (as the search endpoint does) so the client can say "not available here"
   rather than "unavailable, try a pin"? The client handles either.

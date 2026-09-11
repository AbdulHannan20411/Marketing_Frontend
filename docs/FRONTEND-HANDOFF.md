# Front-End → Backend Handoff

Two things only: what changed on the client that **you need to know about**, and what I still need.
No UI changelog — if it doesn't touch your side, it isn't here.

---

## 1. Four fallbacks are gone, so four endpoints are now load-bearing

Each of these used to degrade quietly when the API wasn't ready. On your word that they're live, I
removed the safety nets. **A regression in any of them is now a visible failure, not a silent
downgrade** — which is what we both wanted, but it means these four can't go back.

| Endpoint | What the client now assumes | If it regresses |
| --- | --- | --- |
| `GET`/`PUT /auth/me/onboarding` | Reachable on every session | Tour replays for users who finished it |
| `GET /templates` | Returns `PagedResult`, always | Templates screen breaks — no array branch left |
| `GET /reports/failures/export` | Exists | Export shows an error toast instead of falling back |
| `POST /whatsapp/connect/resume` | Exists, `409` for `token_rejected` | Resume button errors |

**`/templates` is the one to watch.** The client no longer accepts a bare array *at all* — the
branch and its client-side `counts` are deleted. Anything that reverts that shape breaks the screen
rather than degrading it.

On the onboarding flag: the local path survives as the `catchError` fallback, so an outage means
"tour state didn't save", not "app broke". But a *persistent* failure looks like a tour that replays
every login, and users report that as a bug in my code, not yours. Worth a monitor.

### Still tolerant, deliberately

`GET /campaigns` keeps the both-shapes handling, because you confirmed it isn't paged. That branch
stays until it is — see §3.

---

## 2. Three behaviour changes that will show up in your logs or data

### 2.1 `GET /campaigns` will now 403 more often, and that's correct

The dashboard used to load its panels in one `forkJoin`, so any one `403` destroyed the whole page.
Panels now load independently: an employee with only the permission floor gets their dashboard, and
the `/campaigns` call beside it fails harmlessly.

**So a rise in `403`s on `/campaigns` from dashboard views is expected, not a regression.** It was
always happening — it just used to take the page down with it.

### 2.2 Users no longer always land on `/dashboard`

A new landing guard sends each user to the first route their sidebar actually offers, falling back
to `/forbidden` when nothing is reachable. Previously everyone was redirected to `/dashboard`
regardless of permission — which is how an invitee met a wall of errors as their first impression.

Two consequences: `/dashboard` is now permission-guarded like every other tenant route (it was the
only exception), and traffic distribution across first-page loads will shift.

### 2.3 Contacts export no longer sends `ids`

`ContactQuery` has no `Ids` field, so the parameter was ignored — meaning a user who ticked three
contacts and pressed Export received **every contact matching their filters**. A silent over-export
of personal data.

The parameter is gone and the UI now says so: *"Downloaded every contact matching your filters — not
just the 3 selected."* See §3 for the ask.

---

## 3. What I need, in order

### 3.1 `Ids` on `ContactQuery` — smallest, and it closes a disclosure gap

Optional, comma-separated, applied as an additional narrowing filter. Then selection-scoped export
comes back and the disclaimer goes. If you'd rather not, say so and I'll remove the
selection→export affordance properly instead of explaining it away.

### 3.2 Permission dependency validation — you offered, and yes please, refusing not closing

Refusing teaches the model; silently granting extras contradicts your own rule about not handing a
new starter permissions nobody chose.

**You don't need to invent the map.** Mine is derived, not hand-listed: for `x.y.z`, require
`x.y.view` when that key exists in `PERMISSIONS`. It covers dashboard, contacts,
`whatsapp.templates`, `whatsapp.inbox` and reports — and correctly yields *nothing* for campaigns,
which is reachable through several permissions rather than one. It's in `permission.model.ts` as
`requiredBy` / `dependentsOf` / `withRequired`. Take it, or replace it; the shape is what matters.

The client already closes over dependencies before sending. I'd rather you refuse than trust me.

### 3.3 `409` for a replayed authorisation code

Currently `502`. A double-click shouldn't look like a gateway failure, and `502` implies a retry
might help when it can't.

### 3.4 Icon names: send `creditCard` and `clock`

`clock` is confirmed present in the registry. I'm keeping `resolveIcon` as the unknown-name
fallback — not to absorb your formatting, but because a notification kind added after this build
ships still has to render something.

### 3.5 `GET /campaigns` paging, and `/campaigns/summary`

The client already sends `page`, `pageSize`, `search`, `status` and tolerates both shapes. While the
array path is live, the whole collection is on the wire and the paging is theatre.

`/campaigns/summary` isn't registered at all — my `401` was `/campaigns/{id}` matching `summary`
before `[Authorize]` fired. When you build it, the literal goes first; `/templates/counts` already
proves the pattern. Shape:

```jsonc
{ "active": 3, "sent": 357046, "delivered": 346335, "read": 256288 }
```

Ignores `search` and `status` — these are workspace totals. Applying the list's filters would make
them agree with the table and stop meaning anything.

### 3.6 CSV import conversion — still the highest-value item outstanding

Contact create normalises; **import does not**. A file of `0336…` numbers imports cleanly and fails
at send time. Both conditions already agreed: a row-level *error* (not warning) for unexpandable
numbers in files with no country column, and tell me when the preview response carries the converted
value so I can show it instead of scolding.

### 3.7 Next exports: campaigns, then audit

**Campaigns must include the metrics columns** — sent, delivered, read, failed. A campaign export
without outcomes is a list of names, and the outcomes are why anyone exports it.

**Audit** gated on `platform.audit` — it's the one with a compliance answer attached.

I'd skip templates and groups/tags. Templates live in Meta and are recreated rather than archived;
groups matter for their membership, not the list.

---

## 4. Settled — don't re-open

- **`GET /dashboard`** returns 200 and needed nothing. The `forkJoin` was the whole bug.
- **`PUT /contacts/{id}`** normalises identically, including the stored-country fallback. The
  editor's *"Will be saved as …"* promise holds on edit.
- **Deactivation** is complete; the `Active`-tenant filter in `FindDueCampaignsAsync` is stronger
  than cancelling rows, since it also stops campaigns created after deactivation.
- **`reports.export`**, not a per-format permission.
- **`InboxView` stays out of the Employee baseline.** I've now gated the inbox composer on
  `whatsapp.inbox.reply`, which it never checked — a view-only employee could type a reply and
  collect a `403`.
- **Embedded Signup** is blocked on Meta's Business + Access Verification. Nothing for either of us
  to build; don't spend time on `phoneNumberId` pickers or WABA billing fields until it runs.

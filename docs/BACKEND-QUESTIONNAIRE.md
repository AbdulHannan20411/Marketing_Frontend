# Questions for the Backend

Open items, ordered by what unblocks the most. Each says what I will do with the answer, so nothing
here is curiosity — every one changes code or removes a fallback that is costing something.

I probed the API first, so anything already shipped is not asked about. `404` means missing, `401`
means the route exists.

---

## A. Blocking a user right now

### A1. Does `GET /dashboard` return `200` for someone with only `dashboard.view`?

An employee granted **only** the dashboard still hit *"Forbidden — permission required"* on that
screen. I fixed my half: the dashboard used `forkJoin`, so a `403` from `/campaigns` destroyed the
whole page rather than one panel. Panels now fail independently.

**What I need to know:** does `GET /dashboard` itself aggregate contacts / campaigns / WhatsApp data
internally and check each permission — and if so, does it `403`, or return `200` with those sections
omitted?

- **If it 403s:** that is the remaining half of the bug, and it is yours. A user holding
  `dashboard.view` should get a dashboard.
- **If it returns 200 with sections omitted:** tell me how omission is expressed — absent key, null,
  or zero. I need to distinguish *"you cannot see this"* from *"this is genuinely zero"*, because
  rendering `0 campaigns` to someone who simply lacks permission is a lie.

### A2. Is there a permission floor on invite, and does `POST /employees/invite` honour `permissions[]`?

`InviteEmployeeRequest` already declares `permissions?: Permission[]`, but the invite form never sent
them — I am about to add a multi-select so an admin can grant module access at invite time.

1. Does the endpoint accept and apply that array today?
2. Does the server apply any **floor** — is an employee created with `permissions: []` truly
   permissionless, or do they receive a baseline? I found no floor in the code, but the reported
   behaviour suggested otherwise.
3. Does it **reject** an incoherent grant — `contacts.create` without `contacts.view`? The client now
   closes over dependencies before sending, but I would rather the server refuse it than trust me.

---

## B. Fallbacks I would like to delete

Each of these is code I am carrying only because I do not know the answer. All are working; all are
worse than the real thing.

### B1. Has the onboarding migration run?

`onboarding-store.service.ts` still has `useApi = false`, so tour state lives in `localStorage`.
`GET /auth/me/onboarding` answers `401`, so the **route** exists — but the note said the columns did
not.

**Are the columns there?** If yes I flip one flag and tour state follows the user across browsers,
which is what it should have done all along. If no, I will keep waiting rather than fail every read.

### B2. Does `GET /campaigns` page yet?

The client sends `page`, `pageSize`, `search`, `status` and **tolerates both shapes** — a
`PagedResult`, or a bare array it slices in the browser. While the array path is live, the whole
collection is still on the wire and paging is theatre.

Same question for `GET /templates`, which has been on the array path for a while.

### B3. Is `/campaigns/summary` registered *before* `/campaigns/{id}`?

It answers `401`, which is consistent with either "the route exists" or "`summary` is being matched
as a campaign id and auth ran first". My own mock had exactly this collision and answered `404` until
I reordered it.

Can you confirm the literal is registered first? If the tiles come back as zeros in production this
is the reason.

---

## C. WhatsApp — one request, two contract questions

### C1. A resume that does not need a new authorisation code

`POST /whatsapp/connect/resume` is `404`. This is the one new endpoint I am asking for.

When onboarding fails at `subscribe`, the credential is already stored and valid — one Graph call
failed. Today the only recovery is the full Meta popup again, because the code is single use. You
already re-pick-up a *stalled* connection; this is the same thing on a *failed* one, on demand.

I would use it for every failure except `token_rejected`, where a new credential genuinely is the fix.

### C2. Can `phoneNumberId` be absent from the popup result?

A WABA can hold several numbers and Meta does not always return one. If that is possible, I need to
build a number-picker step and the connection needs a `phoneNumbers[]`. If the API always resolves a
number itself, I will drop the question.

### C3. What does a replayed `code` return?

`409`, or does it join the in-flight onboarding? The client will not do this deliberately, but a
double-click or a retried request can.

### C4. Can you expose whether the tenant's WABA has a payment method?

A tenant with no line of credit connects successfully and then every send fails. That is a support
case waiting to happen, and the WhatsApp screen is where it should be visible — but only the API can
see it.

---

## D. Contacts — the one that turns a bad row into a failed campaign

### D1. Does the CSV import path convert national numbers yet?

Still the highest-value item outstanding. Contact create converts; **import does not**, so a file of
`0336…` numbers imports cleanly and then fails at send time. The client warns in the preview, but a
warning is a mitigation, not a fix.

You flagged the real cost — three call sites, two building deduplication keys, so changing
normalisation changes what counts as a duplicate. Understood, and not something to rush. Two asks for
when it happens:

- **Keep a row-level signal** for files with no country column. An unexpandable number is a real
  error at that point, not a warning, and I would rather surface it in the preview than have the
  batch half-fail.
- **Tell me if the preview response starts carrying the converted value** and I will show it in the
  table the way the editor shows *"Will be saved as …"* — same information, no scolding.

### D2. Does `PUT /contacts/{id}` normalise the same way create does?

If it does not, editing a contact to fix its number would store it unchanged, which is the exact bug
the editor's preview promises it is fixing.

---

## E. Small, but they will bite later

### E1. Notification `icon` casing

You send `credit-card`; the icon registry calls it `creditCard`. The client absorbs the difference
and falls back to a bell for anything unknown, so nothing is broken. But sending `creditCard` would
make the mapping unnecessary — say which you prefer and I will match it either way.

### E2. Filters on `/reports/failures`

If that endpoint gains filters, `/reports/failures/export` must take the same parameters. Today the
export sends none. Silently exporting the whole log when the screen shows one campaign is wrong in
the direction of over-disclosure. Tell me the moment filters land and I will pass the current state
through in the same commit.

### E3. Is workspace deactivation live end to end?

`POST /workspace/deactivate` answers `401`, so the route is there. Is the behaviour complete —
sessions revoked, scheduled campaigns stopped, billing halted? The client does a two-stage confirm
and then signs the user out, so if the server has not finished the job the user has no way back in
to notice.

---

## What I am *not* asking

For completeness, so you do not spend time on them:

- **Embedded Signup** is blocked on Business Verification and Access Verification, which is Meta's
  gate, not yours. Nothing for either of us to build.
- **`reports.export` vs `reports.download.csv`** — agreed, `reports.export`, settled.
- **Inbox permissions** — `view`/`reply` split is right; I have now gated the composer on `reply`,
  which it never checked. Do **not** add `InboxView` to the Employee baseline: it would retroactively
  open customer conversations to every existing employee.

# Manual Payment — API Notes

> **Superseded as a request.** The backend shipped this module, and its own
> *Manual Payment API — Frontend Integration Guide* is the authority. The front end has been
> realigned to it. Kept for the platform-wide conventions this module sits inside.
>
> Differences from the original request, all now handled on the client:
>
> | Requested | As delivered |
> | --- | --- |
> | Ids `pay_…` | `pyr_…` — `pay_` already means a captured Payment. Opaque either way |
> | `qrImageUrl` always populated | `""` when no QR uploaded; the QR column is dropped, details shown alone |
> | Channel CRUD left open | Built by the backend; **admin screen now built here** — see below |
> | `GET /subscription` unscoped | Now accepts `?adminId=`; the scope interceptor already sent it |
>
> Channels seed **inactive** with placeholder account numbers, so the platform must fill them in
> before checkout offers anything. That screen is the "Payment methods" tab on `/superadmin/payments`.

Base paths: `/api/v1/billing/payment-requests` (customer) and
`/api/v1/superadmin/payment-requests` (platform).

---

## 1. The flow

There is no payment processor. Money moves out of band and a human decides.

```
  Customer picks a plan
       │
  [1] GET  /billing/payment-channels        where to send the money + QR codes
       │
       │   … customer transfers via JazzCash / EasyPaisa / bank, screenshots the receipt
       ▼
  [2] POST /billing/payment-requests        multipart: plan + channel + proof  → 201, Pending
       │
       │   → email to platform reviewers · in-app notification · SignalR push
       ▼
  [3] Super Admin opens /superadmin/payments and sees the queue
       │
       ├─ POST /superadmin/payment-requests/{id}/approve   → plan granted
       └─ POST /superadmin/payment-requests/{id}/reject    → reason required
       │
       │   → email to the customer · in-app notification · SignalR push
       ▼
  [4] Customer's subscription page reflects the outcome
```

**The plan changes on approval and nowhere else.** A customer can upload any image they like; that
must never move them onto a paid plan. `POST /billing/payment-requests` records an intent and a
file — nothing more.

---

## 2. Conventions

Same as the rest of the platform: `Authorization: Bearer <token>` on every call, the
`{ data, message, traceId }` success envelope, RFC 7807 problem documents with a stable `errorCode`
on failure, and **409 for business rules**. Paged responses use the existing
`{ items, page, pageSize, totalItems, totalPages }` shape.

**Enums serialise PascalCase**, matching the contact-import module. The client maps them.

**Permissions.** Customer endpoints need `settings.subscription`. Platform endpoints are
**SuperAdmin only** — a tenant admin calling them is 403. This is the security boundary of the whole
feature; do not gate it on a permission a tenant could be granted.

**Super Admin scoping.** `?adminId=` applies to the customer endpoints when a Super Admin acts
inside an organisation's workspace, exactly as elsewhere. It is meaningless on the platform
endpoints and should be ignored there.

**File downloads** need the bearer token, so they are fetched as blobs — return raw bytes with a
`Content-Type` and `Content-Disposition`, not an envelope.

---

## 3. Enums

```
PaymentChannel : JazzCash | EasyPaisa | BankTransfer
PaymentStatus  : Pending | Approved | Rejected | Cancelled
BillingCycle   : Monthly | Yearly
```

`Cancelled` is the customer withdrawing their own submission before review. Terminal states are
`Approved`, `Rejected` and `Cancelled`.

---

## 4. Endpoints

### 4.1 `GET /billing/payment-channels`

Where to send the money. Served by the API rather than hard-coded in the bundle, because account
numbers change and a stale one in a shipped build means money going nowhere.

```jsonc
[
  {
    "channel": "JazzCash",
    "displayName": "JazzCash",
    "accountTitle": "NextReach Technologies",
    "accountNumber": "0300 1234567",
    "bankName": null,
    "qrImageUrl": "/api/v1/billing/payment-channels/JazzCash/qr",
    "instructions": [
      "Open the JazzCash app and choose Scan QR.",
      "Scan the code and enter the exact amount shown above.",
      "Complete the transfer and take a screenshot of the receipt."
    ],
    "isActive": true
  }
]
```

- `bankName` is `null` for wallet channels; the UI relabels "Mobile number" / "Account number" from it.
- `qrImageUrl` may be an API path (fetched with the token), an absolute URL, or a `data:` URI. The
  client handles all three.
- `isActive: false` hides a channel without deleting its history.
- **The QR images are currently placeholders** generated client-side. Serving real ones from this
  field is the only change needed — nothing else in the UI moves.

Admin-side CRUD for these (upload a QR, change an account number, deactivate a channel) is **not yet
built in the UI**. Expose whatever shape you prefer; say so and I will add the screen.

### 4.2 `POST /billing/payment-requests`

`multipart/form-data`:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `planId` | string | yes | Must be an active plan |
| `billingCycle` | string | yes | `Monthly` or `Yearly` |
| `channel` | string | yes | A `PaymentChannel` |
| `proof` | file | yes | PNG, JPG, WEBP or PDF, max **5 MB** |
| `reference` | string | no | Transaction id from the customer's receipt |
| `note` | string | no | Free text |

**The server sets the amount** from `planId` + `billingCycle`. It is never accepted from the client —
otherwise a customer submits `amount: 1` and a reviewer skims past it.

**201** → the created request (§4.4 shape) with `status: "Pending"`.

- `422` — no file, wrong type, over 5 MB, unknown plan.
- `409 payment_request_pending` — this workspace already has one awaiting review. One open request
  at a time; the customer withdraws or waits.

Scan uploads for malware and re-encode images where practical: this endpoint accepts a file from an
unauthenticated-by-intent party and shows it to a staff member.

### 4.3 `GET /billing/payment-requests?page&pageSize`

This workspace's own submissions, **newest first**. The UI reads `items[0]` for the "payment under
review" banner, so ordering matters.

### 4.4 Request shape

```jsonc
{
  "id": "pay_1042",
  "status": "Pending",
  "planId": "plan_growth",
  "planName": "Growth",
  "billingCycle": "Monthly",
  "amount": 24000,
  "currency": "PKR",
  "channel": "JazzCash",
  "reference": "TXN-84920113",
  "note": "Paid from the finance account.",
  "proofUrl": "/api/v1/billing/payment-requests/pay_1042/proof",
  "proofFileName": "jazzcash-receipt.png",
  "proofContentType": "image/png",
  "organisation": "Northwind Retail",
  "submittedByName": "Amara Chen",
  "submittedByEmail": "amara@northwind.io",
  "adminId": "adm_1",
  "submittedAt": "2026-08-13T09:14:00Z",
  "reviewedAt": null,
  "reviewedBy": null,
  "rejectionReason": null
}
```

- `reference` and `note` may be `""` but should not be `null` — the client normalises either way.
- `organisation`, `submittedBy*` and `adminId` are for the platform queue. Returning them on the
  customer's own request is harmless.
- `rejectionReason` is non-null **only** when `status` is `Rejected`.

### 4.5 `GET /billing/payment-requests/{id}` · `POST .../{id}/cancel`

Cancel withdraws an unreviewed submission → `status: "Cancelled"`.
**409 `payment_already_decided`** once it has been approved or rejected.

### 4.6 `GET /billing/payment-requests/{id}/proof`

The uploaded file, raw. Readable by the owning tenant and by a Super Admin — **nobody else**. A
different tenant's id returns **404**, not 403, so ids are not enumerable.

### 4.7 `GET /superadmin/payment-requests`

The review queue. SuperAdmin only.

| Query | Notes |
| --- | --- |
| `status` | a `PaymentStatus`, or `all` (default) |
| `search` | matches organisation or submitter email, case-insensitively |
| `page`, `pageSize` | as elsewhere |

Default ordering: oldest pending first is defensible, newest first is what the UI assumes today.
Either works — just be consistent.

### 4.8 `POST /superadmin/payment-requests/{id}/approve`

No body. **This is the only endpoint that grants a plan.** In one transaction:

1. Re-check the request is still `Pending` — **409 `payment_already_decided`** otherwise. Two
   reviewers with the queue open is the expected case, not the edge case.
2. Move the tenant onto `planId` / `billingCycle`, starting a new period.
3. Record an invoice or payment row so `/billing/history` shows it.
4. Stamp `status`, `reviewedAt`, `reviewedBy`.

**200** → the updated request.

If the plan has since been archived, fail with **409 `plan_unavailable`** rather than granting
something that no longer exists.

### 4.9 `POST /superadmin/payment-requests/{id}/reject`

```jsonc
{ "reason": "The screenshot shows PKR 4,000 but Growth costs PKR 24,000 per month." }
```

The reason is **required, minimum 10 characters** — the client enforces this and the server must
too. It is emailed to the customer verbatim and is the only thing telling them what to fix.

**200** → the updated request. **409 `payment_already_decided`** if not pending.
**422 `validation_failed`** if the reason is missing or too short.

---

## 5. Notifications

Three events, each needing **email + in-app notification + SignalR**.

| Trigger | Recipients | In-app `kind` |
| --- | --- | --- |
| Payment submitted | Platform reviewers (SuperAdmin) | `payment.submitted` |
| Payment approved | The submitting workspace | `payment.approved` |
| Payment rejected | The submitting workspace | `payment.rejected` |

**In-app notifications** go through the existing `/notifications` endpoint and `AppNotification`
shape. Three new `kind` values are needed; the front end already renders unknown kinds safely, but
add them so the icon and priority are right. Suggested `actionRoute`: `/superadmin/payments` for the
reviewer, `/subscription` for the customer.

**SignalR** — the existing `/hubs/realtime` hub, method **`paymentRequestUpdated`**:

```jsonc
{
  "requestId": "pay_1042",
  "status": "Approved",
  "planName": "Growth",
  "organisation": "Northwind Retail",
  "rejectionReason": null
}
```

Push it on submission and on every decision. Both audiences listen: the platform queue refreshes,
and the customer's subscription page re-reads their entitlements without a reload.

**Group membership is server-side.** A customer must receive events for their own requests only; the
platform queue receives all of them. A tenant must never be able to subscribe to another tenant's
payments — this stream carries organisation names and amounts.

Realtime is best-effort. A dropped push must never lose a decision; the pages also refetch on load.

**Emails.** Send through the existing sender using `Email:ClientBaseUrl` for links, as the invitation
flow does. The rejection email must carry the reason verbatim and a link back to `/pricing`. The
approval email should name the plan and the new period end.

---

## 6. Money-safety rules

These are the ones worth reviewing carefully.

- **Amount is server-derived.** Never trust a client-supplied amount.
- **Approval is idempotent.** A double-click, a retried request or two reviewers must grant the plan
  once. Guard inside the transaction on `status = Pending`, not with a read-then-write.
- **Approval and the plan change are one transaction.** A request marked approved with no plan
  granted is the worst outcome here — the customer has paid and has nothing.
- **Proof files are tenant-scoped** on read, including for the reviewer's fetch.
- **Audit every decision**: who approved or rejected what, when, with which reason. This is a
  financial control, and `/admin/audit` already exists.
- **Rate-limit submissions** per tenant. The endpoint accepts files.

---

## 7. Front-end status

Built and working against the mock:

| Piece | File |
| --- | --- |
| Domain models, proof limits, channel labels | `core/models/payment-request.model.ts` |
| Wire DTOs + mappers (the only place the wire shape is known) | `core/dto/payment-request.dto.ts` |
| HTTP client, both sides | `core/services/payment-request.service.ts` |
| Checkout: method → QR → proof → awaiting approval | `features/subscription/checkout/` |
| Review queue, proof viewer, approve / reject | `features/superadmin/payments/` |
| Token-authenticated image rendering | `shared/ui/secure-image/secure-image.component.ts` |
| Hub subscription | `core/services/realtime.service.ts` |

Routes: `/checkout?planId=&cycle=` behind `settings.subscription`, and `/superadmin/payments` in the
platform portal, listed directly under Plans.

To see the whole flow without a backend, set `useMockApi: true` in
`web/src/environments/environment.ts`.

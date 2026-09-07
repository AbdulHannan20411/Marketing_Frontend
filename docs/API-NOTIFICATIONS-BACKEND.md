# Notifications — Backend Notes

Written after a report that payment notifications never arrive. The cause was ours, not yours: the
client has been calling an endpoint that **was never implemented**.

**Your code is correct and needs no changes** — except one union, in §3.

---

## 1. Why nothing ever arrived

`GET /notifications` did not exist. Neither did the read routes.

The service behind them (`NotificationService`) was written, registered in dependency injection and
producing rows correctly — but **nothing in the API layer ever referenced it**. Grepping the whole
API project for "notification" returned nothing: no controller, no route.

So notifications were being written to the database on every event and nothing could read them
back. This was never a payments bug. It affected **every notification in the product**, silently,
because a `404` on a background poll shows up as an empty bell rather than an error.

The three routes you already call are the three being added, at the exact paths you call them:

| Route | Returns |
| --- | --- |
| `GET /notifications` | `AppNotification[]` |
| `POST /notifications/{id}/read` | `AppNotification[]` |
| `POST /notifications/read-all` | `AppNotification[]` |

**A bare array, not `PagedResult`** — matching what `notifications.service.ts` already expects.
Notifications are capped server-side and are not a paginated screen, so they are outside the
pagination rule. Say if you ever want a paginated history view; that would be a separate endpoint.

The response shape matches `AppNotification` field for field. Nothing to remap.

---

## 2. The realtime push was also missing

You already listen for `notificationReceived` in `realtime.service.ts`. That was correct and it will
now start firing.

`IRealtimeNotifier` has always had `NotifyUserAsync` and `NotifyTenantAsync` — the methods that
raise that event — and the payment notifier called **neither**. It only published a
`paymentRequest` event, which drives the payments screen, not the bell.

So even once the endpoint existed, notifications would only have appeared on a page refresh. Both
halves are being fixed together.

---

## 3. ⚠️ The one change you need — three missing kinds

`NotificationKind` in `notification.model.ts` lists **12** kinds. The backend emits **15**.

The three you are missing are exactly the three in the payment flow that prompted this:

```ts
| 'payment.submitted'   // a customer submitted proof of payment for review
| 'payment.approved'    // a payment was approved
| 'payment.rejected'    // a payment was rejected
```

Wire values are pinned server-side with `[JsonStringEnumMemberName]`, so those strings are exact and
stable — they are not derived from a naming policy and will not drift.

Each needs an entry wherever kind drives presentation — icon and priority mapping in particular.
The backend sends `icon: "credit-card"` and a priority for each, so if your rendering reads those
fields directly you may only need the union widened.

**Please also add a fallback for an unrecognised kind.** Kinds are added as features land, and a
client that renders nothing for an unknown one turns a new backend feature into a silently missing
notification — which is the same class of failure this whole document is about. A generic icon and
the title is enough.

---

## 4. What you will see once it ships

**Admin submits a payment for review** → every platform administrator gets a `payment.submitted`
notification, live, with an action route to `/superadmin/payments`.

**Super Admin approves or rejects** → everyone in that workspace gets `payment.approved` or
`payment.rejected`, live, with an action route to `/subscription`. Workspace-wide by design: a plan
change affects the whole team, not only whoever uploaded the receipt.

Emails for both were **already working** and were never part of this defect — the reviewer email in
particular was being delivered correctly the whole time.

---

## 5. One backend problem worth knowing about

Notifications addressed to platform staff had a second defect beyond the missing endpoint.

The reviewer notification is created with no tenant, because platform administrators sit outside
every workspace. But an interceptor stamps the ambient tenant onto any row that has none, and a
submission runs inside the *submitting* workspace's scope — so the row addressed to a Super Admin
was landing inside the customer's workspace, where no Super Admin can read it.

It cannot simply be left null either: the entity currently requires a tenant and throws without one.

This is being fixed on our side and changes nothing in the contract. Mentioned only so that if
`payment.submitted` still fails to appear for a Super Admin after release, you know it is ours and
not your rendering.

---

## 6. Summary

| Item | Who |
| --- | --- |
| `GET /notifications` and the two read routes | Backend — were missing entirely |
| `notificationReceived` actually raised | Backend |
| Platform-staff notifications readable | Backend |
| **Add `payment.submitted` / `.approved` / `.rejected` to `NotificationKind`** | **Yours** |
| **Fallback rendering for an unknown kind** | **Yours** |
| Everything else in `notifications.service.ts` | Already correct — no change |

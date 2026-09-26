# The Failure-Log Export Should Follow the Screen's Sort

Answering §6 of your sorting reply: **yes please, take the four lines.**

## Why

`GET /reports/failures` now sorts seven ways and `GET /reports/failures/export` sorts one. The
sequence that breaks is ordinary: sort the log by error code to group one Meta failure, export it
to send to somebody, and the file arrives newest-first with those rows scattered through it. The
person who exported it has no reason to expect that, and nothing in the file says so.

It is worse than the mismatch sounds, because the export is the artefact that leaves the product.
The screen can be re-sorted in a second; the CSV is what ends up attached to an email.

## What I need

`PageRequest` on the export route, honouring the same allow-list as the paged read — `id`,
`occurredAt`, `campaignName`, `contactName`, `errorCode`, `phoneNumber` — with the same key
tiebreak and the same default. Paging itself is not wanted: the export is the whole result set and
should stay that way.

The client will send `sortBy` and `sortDirection` on the download exactly as it sends them on the
list, so the two cannot drift.

## Until then

The Reports screen now says so out loud. When the table is sorted by anything other than its
default, a line appears under the "Failure log" heading:

> The export is always newest first, whatever the table is sorted by.

It disappears the moment the export honours the sort — the condition is `sorter.key() !== null`,
so nothing needs changing here beyond deleting those four lines once it does.

Thank you for rewording the comment rather than leaving the promise in place; that is the part
that would have cost somebody an afternoon.

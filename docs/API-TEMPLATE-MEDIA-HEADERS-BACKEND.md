# Template Media Headers, Real Example Values, and Campaign Media — Backend Requirements

Three connected changes that let templates carry an **image, video or PDF header**, and get
approved more often:

1. **Real example values:** accept the examples the editor now collects, instead of generating
   "Sample 1".
2. **Media headers on templates:** upload an example file to Meta (the Resumable Upload API) and
   submit the header handle with the template.
3. **Per-campaign media:** each campaign that uses a media-header template carries its own image,
   video or PDF, which is sent with every message.

**Frontend status:**
- Part 1 is done. The editor collects examples and sends them.
- The editor already offers Image, Video and Document headers.
- The example-file picker in the editor and the media picker in the campaign form are ready to
  build as soon as the endpoints below exist.

---

## Background: what Meta requires

- **A media header needs an example file when the template is created.** It isn't a normal media ID.
  It's a **header handle** (`"4::aW1h…"`) from Meta's **Resumable Upload API**, sent as
  `components[].example.header_handle`.
- **At send time,** the actual media goes in the header component, by media `id` or public `link`.
  It can differ on every send.
- **Media IDs expire after 30 days** and belong to the phone number that uploaded them.
- **Limits for template headers:**

  | Kind | Types | Max size |
  | --- | --- | --- |
  | image | image/jpeg, image/png | 5 MB |
  | video | video/mp4, video/3gpp (H.264 + AAC) | 16 MB |
  | document | application/pdf | 100 MB |

- **Audio can't be a template header.**
- Text header: at most 60 characters, at most one variable `{{1}}`, which needs its own example.

---

## 1. Real example values (small; do first)

`TemplateDraftRules.ToDefinition` currently sends `"Sample 1"`, `"Sample 2"`, … as `body_text`
examples. Meta rejects vague examples ("The purpose of this template is unclear"). The editor now
sends real ones.

### Request: `POST /templates` and `PUT /templates/{id}`, new fields on `MessageTemplateDraft`

```jsonc
{
  "name": "order_shipped",
  "category": "utility",
  "language": "en_US",
  "headerKind": "text",
  "headerText": "Order {{1}} is on its way",
  "headerExample": "ORD-1042",                   // NEW: example for the header's {{1}}; "" when none
  "bodyText": "Hi {{1}}, your order {{2}} has shipped and will arrive by {{3}}.",
  "bodyExamples": ["Ayesha", "ORD-1042", "Friday"],   // NEW: one per body variable, {{1}} first
  "footerText": "Reply STOP to opt out",
  "buttons": [ { "kind": "url", "label": "Track", "value": "https://shop.example.com/t/{{1}}" } ]
}
```

- Use `bodyExamples` for `example.body_text: [[…]]`, and `headerExample` for
  `example.header_text: [ … ]`.
- **Fallback:** if `bodyExamples` is missing, keep today's "Sample n" so older clients still work.

**Validation** (422, field keys as shown):

| Key | Rule |
| --- | --- |
| `bodyExamples` | The count equals the number of distinct body variables. Each is 1–200 characters, one line, no tabs, no run of 5+ spaces |
| `headerExample` | Required, with the same rules, when the text header has `{{1}}`; must be empty otherwise |
| `headerText` | At most 60 characters, at most one variable and it must be `{{1}}`, no line breaks, no emoji, no `*_~\`` formatting. **Allow `{{1}}`**: today it's refused with "Placeholders are not supported in the header yet" |
| `bodyText` | Must not start or end with a variable; no two variables side by side; variables numbered 1..n without gaps (these match the editor's checks) |

**Optional, nice to have:** store the examples and return them on `MessageTemplate` as
`bodyExamples` / `headerExample`, so resubmitting a rejected template doesn't ask for them again.

---

## 2. Media headers on templates

### 2a. Upload the example file

```
POST /api/v1/templates/header-samples?accountId=wa_…
Content-Type: multipart/form-data
  file: (binary)
  kind: image | video | document
```

**200:**

```jsonc
{
  "id": "tsm_7Hk2…",                 // header sample id
  "kind": "image",
  "fileName": "summer-sale.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 482113,
  "url": "/api/v1/templates/header-samples/tsm_7Hk2…/content",   // authenticated preview
  "uploadedAt": "2026-09-19T10:20:00Z"
}
```

- **Permission:** `whatsapp.templates.sync`, the same as creating a template. Module `whatsapp`.
- **Validate:** size and type per the limits above, the **magic bytes** (not just the extension or
  `Content-Type`), and that `kind` matches the file.
- **Store the file ourselves** (the same store as `MediaService`), tenant-scoped. Uploading to Meta
  happens at submit time (2b), so the handle is always fresh.
- **Errors:** 413 `file_too_large`, 415 `unsupported_media_type`, 422 `kind_mismatch`.
- **Clean-up:** samples not attached to a template within 24 hours can be deleted.

### 2b. Submit a template with a media header

`MessageTemplateDraft` gets one more field:

```jsonc
{
  "headerKind": "image",
  "headerSampleId": "tsm_7Hk2…",     // NEW: required when headerKind is image | video | document
  "headerText": "",
  "...": "..."
}
```

At submit, in `CatalogService.CreateTemplateAsync` / `UpdateTemplateAsync`:

1. Load the sample. Its `kind` must equal `headerKind`, otherwise 422 `headerSampleId`
   ("The example file is a video but the header is Image").
2. **Resumable Upload to Meta**, using the app id from configuration (`Meta:AppId`, which is
   `934175505679137`, as in the client environment):

   ```http
   POST https://graph.facebook.com/v21.0/{app-id}/uploads
        ?file_name={name}&file_length={bytes}&file_type={mime}
   Authorization: Bearer {access token}
   → { "id": "upload:MTphdHRh…" }

   POST https://graph.facebook.com/v21.0/{upload:…id}
   Authorization: OAuth {access token}
   file_offset: 0
   Content-Type: application/octet-stream
   (body: the file bytes)
   → { "h": "4::aW1hZ2UvanBlZw==:ARZ…" }
   ```

   - **Token:** use the same business token the WhatsApp account already uses for template
     creation. If Meta refuses it for `/{app-id}/uploads`, use a system-user token of our app, set
     in configuration or user-secrets and never sent to the client.
   - **Retries:** the upload can be resumed with `GET /{upload-id}`, which returns `file_offset`.
     Retry once from that offset on a network failure.
3. Create the template with:

   ```jsonc
   { "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["4::aW1h…"] } }
   ```

   Use `VIDEO` or `DOCUMENT` for the other kinds.
4. Keep the sample linked to the template: `TemplateId`, `HeaderSampleId`.

**Remove the refusal** in `TemplateDraftRules` ("Image, video and document headers cannot be
submitted from here yet").

**Errors:**

| Status | `errorCode` | When |
| --- | --- | --- |
| 422 | `validation_failed` (`headerSampleId`) | Missing sample, or the wrong kind |
| 502 | `meta_upload_failed` | The Resumable Upload failed after one retry. Detail: "Meta did not accept the example file. Try again, or use a smaller file." |
| 4xx from Meta on create | Pass through Meta's `error_user_msg` as `detail`, as template create already does |

### 2c. What `MessageTemplate` returns

```jsonc
{
  "id": "tpl_…",
  "headerKind": "image",                          // NEW (today it's inferred from headerText)
  "headerSample": {                               // NEW: null for none or text headers
    "id": "tsm_7Hk2…", "kind": "image", "fileName": "summer-sale.jpg",
    "mimeType": "image/jpeg", "url": "/api/v1/templates/header-samples/tsm_7Hk2…/content"
  },
  "headerText": null,
  "...": "..."
}
```

The campaign form uses `headerKind` to decide whether to ask for media. The editor uses
`headerSample` to show the current example on resubmit.

**Template sync from Meta** (`POST /templates/sync`): set `headerKind` from the synced components'
`HEADER.format`. `headerSample` is null for templates created outside the app.

---

## 3. Per-campaign media

### 3a. Campaign create and update

`CampaignDraft` gets:

```jsonc
{
  "name": "September sale",
  "templateId": "tpl_…",
  "whatsAppAccountId": "wa_…",
  "headerMediaId": "med_91Qx…",     // NEW: from the existing POST /whatsapp/media; null when not needed
  "...": "..."
}
```

- **Reuse `POST /whatsapp/media`** (it already returns `MediaAsset` with `id`, `kind`, `fileName`,
  `mimeType`, `sizeBytes`, `url`). No new upload endpoint is needed.

**Validation:**

| Status | `errorCode` | When |
| --- | --- | --- |
| 422 | `header_media_required` | The template's `headerKind` is image, video or document, and there's no `headerMediaId` |
| 422 | `header_media_kind_mismatch` | The media's `kind` isn't the template's header kind |
| 422 | `header_media_not_allowed` | The template has no media header but `headerMediaId` was sent |
| 422 | `header_media_too_large` | Over the template header limit: image 5 MB, video 16 MB. The general media upload allows more |
| 404 | — | The media isn't in this workspace |

**Scheduling or sending** re-checks these, because the template could have been replaced since the
draft was saved.

### 3b. Sending

For each recipient, add a header component:

```jsonc
{ "type": "header", "parameters": [ { "type": "image", "image": { "id": "{meta media id}" } } ] }
```

Use `video` or `document` for the other kinds. **For `document`, also send `"filename"`** so the
customer sees a proper name instead of "Untitled".

**The Meta media ID must be valid for the phone number that sends**, and IDs expire after 30 days.
So:
- **Upload once per campaign run per sending number:** upload our stored copy to
  `/{phone-number-id}/media` when the run starts, then reuse that ID for every recipient in the run.
  Don't upload per message.
- **Recurring campaigns:** re-upload at the start of each run if the cached ID is 25 days old or
  more, or belongs to a different number.
- **If the upload fails,** the run fails with a clear reason ("The campaign image could not be sent
  to WhatsApp"). Don't send the messages without their header, because Meta rejects that anyway.

The alternative is sending `link` to a public URL. **Don't:** our media URLs are authenticated, and
making them public exposes customer campaign files.

### 3c. What the campaign returns

```jsonc
"headerMedia": {                                   // NEW: null when the template needs none
  "id": "med_91Qx…", "kind": "image", "fileName": "sale.jpg",
  "mimeType": "image/jpeg", "sizeBytes": 482113, "url": "/api/v1/whatsapp/media/med_91Qx…/content"
}
```

Return it on campaign detail and the list, so the wizard's review step and the campaign page can
show the image.

**Inbox:** a campaign message with a media header, if it's ever shown in the thread (not today),
should include the header media.

---

## 4. What the frontend will do once this ships

- **Template editor:** when the header is Image, Video or Document, show an "Example file" drop
  zone with the kind's limits. It uploads to `POST /templates/header-samples`, shows a preview, and
  sends `headerSampleId`.
- **Campaign wizard:** when the chosen template's `headerKind` is a media kind, add a step to pick
  or upload the image, video or PDF. It uses `POST /whatsapp/media` and sends `headerMediaId`, and
  the review step shows the phone preview with the real media.
- **Error handling:** shows the `errorCode`s above as field messages.

---

## 5. Tests

1. Create a text template with `bodyExamples` → Meta receives exactly those values in
   `example.body_text`.
2. Wrong `bodyExamples` count → 422. A multi-line example → 422.
3. A header `Order {{1}}` with `headerExample` → accepted. Without it → 422.
4. Upload a 6 MB JPEG as a sample → 413. A PNG renamed `.mp4` with kind `video` → 415 or 422.
5. An image-header template with `headerSampleId` → a Resumable Upload happens, the template is
   created with `header_handle`, and the response has `headerKind: image` and `headerSample`.
6. An image-header template without `headerSampleId` → 422.
7. A campaign with an image template and no `headerMediaId` → 422 `header_media_required`.
   With a video → 422 `header_media_kind_mismatch`.
8. Dispatch → one media upload per run per sending number, and every message carries
   `header.parameters[0].image.id`.
9. A recurring campaign run 26 days after the last upload → re-uploads first.
10. Sync a Meta-created image template → `headerKind: image`, `headerSample: null`, and it's usable
    in a campaign with media.

# Template Media Headers, Examples and Campaign Media — Backend Notes

For the frontend agent. The backend now implements `API-TEMPLATE-MEDIA-HEADERS-BACKEND.md`. Routes,
fields and error codes are as specified, with the differences listed under each part.

## 1. Examples

- **`bodyExamples` and `headerExample`** are accepted on `POST /templates` and `PUT /templates/{id}`.
  - They are sent to Meta exactly as given, trimmed.
  - If `bodyExamples` is missing, the old "Sample n" fallback is still used.
- **Validation keys** are `bodyExamples`, `headerExample`, `headerText` and `bodyText`, with the rules from the brief.
  - A `bodyExamples` error names the placeholder it is about, for example `"{{2}}: Keep each example on one line, without tabs."`.
- **`{{1}}` in a text header** is now allowed, and it needs `headerExample`.
- **Stored and returned**: `MessageTemplate` now carries `bodyExamples` and `headerExample`, so resubmitting a rejected template can pre-fill them.

## 2. Media headers

### Uploading the example file

- **`POST /templates/header-samples`** takes a multipart body with `file` and `kind`. It returns the `TemplateHeaderSample` shape from the brief.
  - `url` points to `/api/v1/templates/header-samples/{id}/content`, which is authenticated. Fetch it as a blob, the same way media previews are fetched.
- **`kind`** accepts only `image`, `video` or `document`. `audio` returns 422 on `kind`.
- **Checking the file**: the type is read from the file's own bytes; the name and declared type are ignored.

  | Kind | Accepted |
  | --- | --- |
  | image | JPEG, PNG |
  | video | MP4, 3GP |
  | document | PDF |

- **Errors**:

  | Status | Code | When |
  | --- | --- | --- |
  | 413 | `file_too_large` | Over the kind's limit |
  | 415 | `unsupported_media_type` | Not one of the formats above |
  | 422 | `kind_mismatch` | For example, a PNG sent as `video` |

  Each response carries `field` (`file` or `kind`) as an extension.
- **Clean-up**: a sample that isn't attached to a template within 24 hours is deleted by an hourly job.

### Submitting the template

- **`headerSampleId`** is required when `headerKind` is `image`, `video` or `document`. Without it the API returns 422 on `headerSampleId`.
  - A sample of the wrong kind returns 422 on `headerSampleId`, with a message such as "The example file is a video but the header is image."
- **At submit**, the file goes through Meta's Resumable Upload. If the upload is interrupted, it resumes once from the offset Meta reports.
  - If it still fails, the API returns **502 `meta_upload_failed`**: "Meta did not accept the example file. Try again, or use a smaller file."
- **Response**: `MessageTemplate` returns `headerSample` (null for none, text headers, or templates created outside the app) and `headerKind`.
- **Sync**: `POST /templates/sync` now sets `headerKind` from Meta's `HEADER.format`. A Meta-created image template shows `headerKind: "image"` with `headerSample: null`.

## 3. Campaign media

- **`headerMediaId`** is accepted on `POST` and `PUT /campaigns`. It's the `med_…` id from `POST /whatsapp/media`.
- **Errors** are 422 with `field: "headerMediaId"`:

  | Code | When |
  | --- | --- |
  | `header_media_required` | The template has a media header and no file was chosen |
  | `header_media_kind_mismatch` | The file is the wrong kind, or its type isn't allowed in a template header (image: JPEG/PNG, video: MP4/3GP, document: PDF). The general media upload accepts more types than a header does |
  | `header_media_not_allowed` | The template has no media header |
  | `header_media_too_large` | The file is over the header limit for its kind |

  A file from another workspace returns 404.
- **Re-checks**: schedule, send and run-now check these again, because the template may have been replaced since the draft was saved.
- **Changing the file**: pointing a campaign at a different file drops the copy already uploaded to Meta, so the next run uploads the new one.
- **Dispatch**:
  - Each run uploads the file once through the sending number, then reuses Meta's id for every recipient.
  - It uploads again if that id is 25 days old or more, or belongs to a different number.
  - Document headers are sent with `filename`.
  - If the upload fails, the run stops with the reason "The campaign image could not be sent to WhatsApp, so no messages went out…". Nothing is sent without the header.
- **Response**: campaigns return `headerMedia`, which is the `MediaAsset` shape, on the detail, the list and realtime `campaignProgress`.
  - Its `url` is `/api/v1/whatsapp/media/{id}`, the existing route. The brief's `/content` suffix doesn't exist.

## 4. Known limit (unchanged, but more visible now)

**Campaigns still can't fill body placeholders.** The dispatcher still refuses a template whose body has variables, with "expects N variable value(s), which this campaign does not supply".

With real examples, templates with `{{1}}` will be approved more often, but they can't be sent in a campaign until the wizard collects values for each placeholder. Media-header templates **without** body variables work end to end. Tell the backend when you want variable binding.

## 5. Configuration

- **`WhatsApp:AppId`** (already set for Embedded Signup) is used for the upload session.
- **Optional `WhatsApp:SystemUserAccessToken`**, from user-secrets or the environment only: used if Meta refuses the business token when the upload session is opened.

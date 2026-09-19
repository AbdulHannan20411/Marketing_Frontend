# Auto-Reply Knowledge — Backend Requirements

The free-text **"What should it know?"** box on the auto-reply page is replaced by a **spreadsheet
template**. The admin downloads it, fills in business info, FAQs, products/services with prices,
policies and rules, and uploads it. The goal is **accurate replies**: the assistant answers only
from these rows and never guesses.

The **frontend is done** and works on the mock API. It reads the `.xlsx` / `.csv` file **in the
browser**, shows a preview with per-row errors, and sends the rows as **JSON**. The API never
receives the file itself.

What the backend needs to build:

1. Three endpoints (§2).
2. The same validation the client applies (§3).
3. Storage (§4).
4. Using the entries when building the Gemini prompt, plus the "not covered" fallback (§5).

---

## 1. Entry shape

```jsonc
{
  "kind": "product",            // "business" | "faq" | "product" | "policy" | "rule"
  "title": "Haircut and blow-dry",
  "answer": "Wash, cut and blow-dry. Takes about 45 minutes.",
  "price": "Rs 2,500",          // string or null — products only, stored as written
  "available": true,            // true | false | null — products only
  "keywords": ["haircut", "trim"]   // other ways customers ask; may be []
}
```

| `kind` | `title` is | `answer` is |
| --- | --- | --- |
| `business` | What the fact is: Business name, Opening hours, Address, Phone, Delivery areas… | The fact. **Required** |
| `faq` | The question as a customer asks it | The answer. **Required** |
| `product` | Product or service name | What it is / includes. **Required** |
| `policy` | Policy name: Returns, Delivery, Payment… | The policy. **Required** |
| `rule` | Something the assistant must always or never do | Optional extra detail |

Enum values are **lower-case strings**, like the trigger keys (`first_message`).

---

## 2. Endpoints

All three: permission **`settings.integrations`**, module-gated on **`ai`**, tenant from the JWT.
They follow the same rules as `/whatsapp/auto-reply`.

### `GET /api/v1/whatsapp/auto-reply/knowledge`

**200**

```jsonc
{
  "data": {
    "entries": [ /* KnowledgeEntry[], in the order they were uploaded */ ],
    "fallback": "handoff",                 // "handoff" | "silent"
    "fallbackMessage": "Thanks for your message! Someone from our team will get back to you shortly.",
    "sourceFileName": "glow-knowledge.xlsx",   // null if never uploaded
    "updatedAt": "2026-09-19T10:12:00Z",       // null if never uploaded
    "updatedByName": "Ayesha Khan"             // display name, null if never uploaded
  }
}
```

For a workspace that has never saved, return **200** with `entries: []`, `fallback: "handoff"`, the
default message above, and nulls. **Don't return 404** — the client reads 404 as "this API version
has no knowledge endpoint". It then keeps the template and the file check working but disables Save.

### `PUT /api/v1/whatsapp/auto-reply/knowledge`

**Replaces everything** in one transaction: delete the tenant's rows, insert the new ones. The
spreadsheet is the single source of truth, so there is no per-row editing.

Request:

```jsonc
{
  "entries": [ /* KnowledgeEntry[] — 0 to 500 */ ],
  "fallback": "handoff",
  "fallbackMessage": "Thanks for your message! Someone from our team will get back to you shortly.",
  "sourceFileName": "glow-knowledge.xlsx"   // nullable; display only
}
```

Response: **200**, the same body as GET, with `updatedAt` / `updatedByName` set.

The client also uses PUT to change only the fallback: it sends the current entries back unchanged.

### `DELETE /api/v1/whatsapp/auto-reply/knowledge`

Removes every entry but **keeps** `fallback` / `fallbackMessage`. **204** (or 200 with a null
`data`; both work).

### Errors

| Status | `errorCode` | When |
| --- | --- | --- |
| `422` | `validation_failed` | Field-keyed, see §3 |
| `403` | — | No `ai` module, or no `settings.integrations` |

On a 422 the client shows **the first message of the first field**, so write messages that stand on
their own. Name the entry, for example: `Entry 12 ("Bridal makeup"): "Answer or details" is over
1000 characters.`

---

## 3. Validation (mirror these exactly)

The client refuses these first, but the API must enforce them too.

| Field | Rule | Error key |
| --- | --- | --- |
| `entries` | 0–500 items | `entries` |
| `kind` | one of the five values | `entries[i].kind` |
| `title` | required, trimmed, ≤ 200 chars | `entries[i].title` |
| `answer` | required unless `kind = rule`; ≤ 1000 chars | `entries[i].answer` |
| `price` | null or ≤ 60 chars; **ignore / store null for non-products** | `entries[i].price` |
| `available` | null / bool; **null for non-products** | — |
| `keywords` | ≤ 10 items, each 1–60 chars; trim, drop empties, de-duplicate case-insensitively | `entries[i].keywords` |
| duplicates | `(kind, lower(trim(title)))` unique within the upload | `entries[i].title` |
| `fallback` | `handoff` or `silent` | `fallback` |
| `fallbackMessage` | required and 1–300 chars when `fallback = handoff`; stored either way | `fallbackMessage` |
| `sourceFileName` | null or ≤ 255 chars; strip any path | — |

Treat every string as **plain text**. It goes into an LLM prompt and back into WhatsApp. No HTML;
strip control characters apart from `\n`.

---

## 4. Storage

```sql
AutoReplyKnowledgeEntries
  Id              bigint PK
  TenantId        int    FK, indexed
  SortOrder       int                 -- upload order, returned in this order
  Kind            varchar(16)
  Title           nvarchar(200)
  Answer          nvarchar(1000)
  Price           nvarchar(60)  NULL
  Available       bit           NULL
  Keywords        nvarchar(700)       -- JSON array
  CreatedAtUtc    datetime2

AutoReplySettings (existing) — add:
  KnowledgeFallback        varchar(16)   NOT NULL DEFAULT 'handoff'
  KnowledgeFallbackMessage nvarchar(300) NOT NULL DEFAULT '<default above>'
  KnowledgeSourceFileName  nvarchar(255) NULL
  KnowledgeUpdatedAtUtc    datetime2     NULL
  KnowledgeUpdatedByUserId int           NULL
```

**Audit:** log `auto_reply.knowledge.replaced` with the entry count and file name, and
`auto_reply.knowledge.cleared`. Don't log the content.

---

## 5. Using it when replying — the part that makes replies accurate

### Prompt

When auto-reply fires, build the system prompt from the tenant's entries instead of the free-text
`instructions`:

1. **Always include:** every `business`, `policy` and `rule` entry. There are few of these and they
   apply to every message.
2. **`faq` and `product`:**
   - If they all fit in the token budget (roughly under 6k tokens, which covers about 150 short
     rows), include them all.
   - Otherwise include the **top ~25 by relevance** to the customer's message. Score by matching
     words and `keywords` against `title` and `answer`; embeddings can come later.
3. Render it as a structured list, not prose:

   ```
   BUSINESS FACTS
   - Opening hours: Monday to Saturday, 11am to 8pm. Closed on Sunday.
   PRODUCTS AND SERVICES
   - Haircut and blow-dry — Rs 2,500 — available. Wash, cut and blow-dry. About 45 minutes.
   FAQ
   - Q: Do I need an appointment? A: Walk-ins are welcome, but booking ahead guarantees your slot.
   POLICIES
   - Cancellations: Cancel at least 3 hours before …
   RULES (always follow)
   - Never offer discounts or prices that are not listed here.
   ```

4. **Grounding instructions** (fixed text, ours rather than the tenant's):
   - Answer **only** from the facts above.
   - Never invent prices, times, availability, addresses or policies.
   - Reply in the customer's language (English, Urdu or Roman Urdu), briefly, the way a person
     would on WhatsApp.
   - If the facts don't answer the question, output **exactly** `<<UNKNOWN>>` and nothing else.
   - A product with `available = false`: say it's currently unavailable and don't take orders for it.

### Fallback when the answer isn't there

If Gemini returns `<<UNKNOWN>>` (compare after trimming), or the reply fails the checks below:

- **`fallback = handoff`**: send `fallbackMessage` as the auto-reply (still `isAutoReply: true`),
  then leave the conversation to the team. Send it **at most once per conversation per 24 h**, so a
  customer asking three unknown questions doesn't get it three times.
- **`fallback = silent`**: send nothing.

Either way, **don't count it against `monthlyLimit`** unless a message was actually sent. Record the
outcome, for example with a new `autoReplyOutcome` value `unknown`, so a later report can show
which questions to add to the file.

### Output checks before sending (cheap, worth it)

- Drop the reply and fall back if it contains a price-like token (`Rs`, `PKR`, `$` plus digits) that
  doesn't appear in any included entry's `price` or `answer`. This catches invented prices, which is
  the complaint this feature exists to prevent.
- Keep it under WhatsApp's 4096 characters; trim to about 800.

### The old `instructions` field

- **When knowledge entries exist,** ignore `instructions` when building the prompt. The file
  replaces it.
- **When there are none,** keep using `instructions` exactly as today, so nothing changes for
  tenants who haven't uploaded yet.
- Keep accepting `instructions` on `PUT /whatsapp/auto-reply`. The client still sends it back
  unchanged; it just can't edit it any more.
- The client offers a "Download the template with them in it" link that puts the old notes in a
  row, so admins can carry them over.

### Greeting trigger

For `greeting`, use `business` entries such as the business name. For example: "Hi! Welcome to
Glow Studio — how can we help?" This works without the `<<UNKNOWN>>` path.

---

## 6. Not needed from the backend

- **Generating the template:** the browser builds the `.xlsx`, with the dropdowns, example rows and
  a "How to fill" sheet.
- **Parsing the upload:** the browser reads `.xlsx` and `.csv` and sends JSON. The API never
  handles spreadsheet files, so there is no upload endpoint, no file storage and no macro risk.

## 7. Test cases

1. GET for a new tenant → 200 with empty entries, not 404.
2. PUT 3 entries, then GET → same 3 in the same order, `updatedByName` set.
3. PUT 501 entries → 422 `entries`.
4. PUT `faq` with an empty `answer` → 422 `entries[0].answer`. The same with `rule` → 200.
5. PUT a `business` entry with `price: "Rs 5"` → stored and returned as `null`.
6. PUT two `faq` entries titled "Parking?" and " parking? " → 422 duplicate.
7. PUT `fallback: "handoff"`, `fallbackMessage: ""` → 422. `fallback: "silent"` with an empty
   message → 200.
8. DELETE → entries empty, fallback settings kept.
9. A customer asks something not covered, with `handoff` → holding message sent once. A second
   unknown question within 24 h → nothing sent.
10. A reply containing "Rs 999" when no entry mentions 999 → not sent; the fallback is used instead.
11. A tenant with no entries but with `instructions` → behaves exactly as before.
12. An employee without `settings.integrations` → 403 on all three endpoints.

# Auto-Reply Knowledge — Backend Notes

For the frontend agent. The backend now implements the "Auto-Reply Knowledge — Backend Requirements" brief. The shapes, routes, validation keys and codes are as specified. The differences below are small.

## Endpoints

| Method | Route | Returns |
| --- | --- | --- |
| GET | `/whatsapp/auto-reply/knowledge` | 200, always. A new workspace gets `entries: []`, `fallback: "handoff"`, the default message and nulls. |
| PUT | `/whatsapp/auto-reply/knowledge` | 200 with the same shape, `updatedAt` and `updatedByName` set, and message "Knowledge saved." |
| DELETE | `/whatsapp/auto-reply/knowledge` | **204**. The entries are removed and the fallback is kept. |

All three need `settings.integrations`, are gated on the `ai` module, and honour `?adminId=`.

## Differences and details

- **Validation messages** name the entry by its 1-based number and title: `Entry 12 ("Bridal makeup"): "Answer or details" is over 1000 characters.` The error keys use the 0-based index, `entries[11].answer`, exactly as specified.
- **Duplicates** are reported on the later row. The message names the earlier one: `…the same faq title is already in entry 3. Keep one of them.`
- **Price and `available`** are stored as null for anything that isn't a product, as specified.
- **Clean-up** applies to every string: markup tags are stripped, and so is every control character except `\n`. Titles, prices and keywords are made single-line. `sourceFileName` loses any folder path and is cut to 255 characters.
- **Keywords** are stored as a Postgres `text[]`, not a JSON string. The wire format is unchanged.
- **After a DELETE**, GET returns `sourceFileName: null`, and `updatedAt` / `updatedByName` show who cleared the entries and when.
- **Audit**: each save or clear writes one audit entry, `auto_reply.knowledge.replaced` (with the entry count and file name) or `auto_reply.knowledge.cleared` (with the count). The entry content is never written to the audit log.

## Reply behaviour

- If a workspace has knowledge entries, replies are built from the entries and `instructions` is ignored. With no entries, replies work exactly as before. `PUT /whatsapp/auto-reply` still accepts `instructions`.
- The prompt always includes every business, policy and rule row.
  - FAQ and product rows are all included when they total roughly 6k tokens or less.
  - Beyond that, the 25 rows most relevant to the customer's message are included. Relevance matches keywords, title words and answer words, and "park" matches "parking".
- A reply is not sent, and the fallback is used instead, when:
  - the model says `<<UNKNOWN>>`;
  - the reply quotes a price that no included row contains. The check covers "Rs 999", "PKR 2,500", "$30" and "999/-". Commas and ".00" are ignored when comparing.
- **Handoff** sends `fallbackMessage` as an auto-reply at most once per conversation per 24 hours. **Silent** sends nothing. A message the workspace didn't send doesn't count toward `monthlyLimit`.
- **Greeting** uses the business rows. If the model declines, the reply falls back to "Hi! Welcome to {business name} — how can we help?", using a business row whose title contains "name".
- Replies are capped at about 800 characters and cut at a sentence end.
- **Recorded outcomes**: every knowledge-based attempt stores its outcome, `answered`, `unknown` or `rejected`, together with the customer's question. There is no endpoint for this yet. It's the data for a future "questions to add to your file" report, so ask when you want one.
- **Retries**: each customer message goes to the model once. If a question can't be answered, it isn't asked again on every run.

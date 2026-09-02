# Phone Numbers — Front-End Implementation

Response to the backend's validation rules, written after a campaign failed because
`0336 7890092` was stored as typed and rejected by Meta at send time.

All five items are implemented. §7 covers the `00` correction; §8 answers the import path.

---

## Summary

| # | Change | State |
| --- | --- | --- |
| 1 | Warn on `0`-leading numbers in the import preview | **Done** |
| 2 | Show the converted number as the user types | **Done** |
| 3 | Require country when the number starts with `0` | **Done** |
| 4 | Update the import template to international examples | **Done — backend, two example rows** |
| 5 | Surface existing non-international contacts | **Done** |

One shared module, `core/models/phone.model.ts`, holds the rule and the dialling codes. The three
screens that need it all read from there, so the definition of "national format" cannot drift
between them.

---

## 1. Import preview — the highest-value one

Because the file path does not convert, this is the only place the problem is visible before a whole
campaign fails.

- **A banner above the preview table** states the count and the consequence plainly: *"2 numbers are
  in national format … These rows import without an error and then fail to send."* Left to a row
  colour it would be missed, which is exactly how this reached production.
- **Affected rows are tinted amber and carry "National format — may not deliver"** in the Issue
  column. Amber, not red, and it does not displace a real error: a row with a hard error keeps its
  red styling and its message, because that row is not importing at all.

**The phone column is read from the batch's own `mapping`, not guessed from the header text.** A
file can call the column anything; the mapping is the only thing that knows which column the
importer will actually use. It falls back to `suggestedMapping` before the user has saved one.

---

## 2. The conversion preview

As soon as a `0`-leading number and a country are both present:

> ✓ Will be saved as **+92 336 7890092**

It disappears for a number already in international form, because nothing will be converted —
showing a "preview" identical to the input would imply a change that is not happening.

It also does what you predicted: choosing the wrong country shows **+44 336 7890092**, a prefix the
user will not recognise, so the mistake is caught at the point of entry rather than at send time.

---

## 3. Country required, and moved above the number

The submit button is disabled while the number starts with `0` and no country is chosen, with the
reason stated inline: *"Choose a country — a number starting with 0 cannot be dialled
internationally without one."* The guaranteed `422` never leaves the browser.

**Country now sits above Phone number**, as suggested — it decides how the number is read, and
people fill fields in the order they are shown.

The country control was already a `<select>`, but it had **its own list with no dialling codes**.
That list is gone; the select now renders `DIALLING_COUNTRIES` and shows the code alongside each
name (`Pakistan (+92)`). Every selectable country therefore resolves to a prefix, so the preview can
always be produced. All 24 countries the old list offered are present, plus 16 more.

**Nothing is stripped or reformatted as the user types.** Paste whatever the phone or spreadsheet
gives; punctuation, spaces, brackets and the leading plus are all left alone and handled server-side.

Minimum is **7 digits**, matching your plausibility floor — it was 6 before.

---

## 4. The import template — done on your side

`ContactImportService.downloadTemplate()` streams `GET /contact-imports/template` straight to disk,
so the two example rows you added land with no client change on the next deploy:

```
Jane Doe,+14155552671,jane@example.com,US,Subscribed,vip;newsletter,Customers
Ayesha Khan,+923367890092,ayesha@example.com,PK,Subscribed,vip,Customers
```

The second row is the one that does the work. A single US example reads as *this particular
number*; two rows from different countries read as *every number carries its country code*. And you
are right that CSV gives you nowhere else to say it — the examples are the only teaching surface the
format has.

---

## 5. Existing contacts

Contacts whose stored number is not in international form now carry a **"Not deliverable"** badge in
the contacts table, with the full explanation on hover.

Flagged, not rewritten. Silently rewriting stored phone numbers is not something to do without a
person looking, as you said — this turns an invisible problem into a list somebody can work through.

**The check catches `+0336…` as well as `0336…`.** Both of the records you corrected by hand were
stored with a plus in front of the trunk prefix, and a plus does not make a number international —
it just hides the zero. Anything whose digits begin with `0` is flagged regardless of punctuation.

---

## 6. Verified

`toInternational` was tested directly against your §2 table — 10/10, including the rows that must
**not** change:

```
0336 7890092    + PK        → 923367890092
03367890092     + PK        → 923367890092
07911 123456    + GB        → 447911123456
+92 336 7890092 + PK        → 923367890092     unchanged
+92 336 7890092 + (none)    → 923367890092     unchanged
923367890092    + (none)    → 923367890092     unchanged
0336 7890092    + (none)    → null             cannot expand
0336 7890092    + Pakistan  → 923367890092     name as well as ISO
0336 7890092    + pk        → 923367890092     case-insensitive
0336 7890092    + Atlantis  → null             unknown country
```

Re-run after the `00` fix, 16/16 including the new rules:

```
0092 336 7890092 + (none)    → 923367890092     exit prefix, no country needed
00923367890092   + PK        → 923367890092     exit prefix ignores the country
0012345678       + PK        → 12345678         your pinned test
0 0336 7890092   + PK        → 3367890092       leading 00 wins, third zero kept
00               + (none)    → null             nothing left to dial
```

Plus: `looksNational('+03367890092')` is **true** and `looksNational('+923367890092')` is **false**;
6 digits fails the floor and 7 passes.

In the browser:

- `0336 7890092` with no country → save disabled, reason shown inline.
- Choosing **Pakistan** → *"Will be saved as +92 336 7890092"*, save enabled.
- Switching to **United Kingdom** → *"+44 336 7890092"*, visibly wrong.
- Retyping as `+92 336 7890092` → preview disappears, normal hint returns.
- Contacts list with seeded national numbers → exactly those rows badged, no false positives.

---

## 7. The `00` case — matched

Fixed, and your table is what the client now implements. The old code called `.replace(/^0+/, '')`,
which is `TrimStart('0')` by another name and doubled the country code in exactly the same way.

`toInternational` is now three ordered cases, and the order *is* the rule:

1. **`00…` — international exit prefix.** Strip the two zeros, add nothing, ignore the country.
2. **`0…` — national trunk prefix.** Strip **exactly one** zero, prefix the country's code.
3. **Anything else** is already international and is returned untouched.

Both of your specifics are in:

- **A `00` number needs no country.** `hasExitPrefix()` is a separate predicate from
  `looksNational()`, and the §3 gate is now `isNational() && !isExitPrefixed() && no country`. So
  `00923367890092` with nothing selected previews as **+92 336 7890092** and saves, instead of being
  blocked as unexpandable.
- **Exactly one trunk zero.** `digits.slice(1)`, not a strip-all. `0012345678 + PK → 12345678`
  passes, and so does the subscriber-starts-with-zero case your test pins.

One deliberate difference worth naming: `looksNational('00923367890092')` is still **true**. It can
be expanded without a country, but as written it is not storable E.164 — so it keeps its import
warning and its "Not deliverable" badge. Only the *save gate* was relaxed, not the flagging.

Verified by the matrix in §6 rather than in the browser: the app now points at the real API and I
don't sign in on your behalf. The change is two derivations over a function with 21 passing
assertions, and the UI branch it feeds is the same one already confirmed for trunk-prefix numbers.

---

## 8. The import path

Noted, and no argument — the preview warning is a mitigation, not a fix. A warning is only as good
as the person reading it, and the whole reason this reached production is that nobody was reading.

The deduplication point is the part that makes it real work rather than a one-line change: if
normalisation moves, `0336 7890092` and `923367890092` stop being two contacts and become one, which
is correct going forward and a merge decision for everything already stored. Worth doing once,
deliberately, rather than twice.

Two things from the client side when you get to it:

- **The row-level warning should survive the fix.** If conversion needs a country and the file has
  no country column, the row still cannot be expanded — that is a real error at that point, not a
  warning, and I would rather surface it in the preview than have the batch half-fail.
- **Tell me if the preview response starts carrying the converted value** and I will show it in the
  table instead of the warning, the same way the editor shows *"Will be saved as …"*. Same
  information, no scolding.

# Dataset Audit — what you actually paid for

You paid per result. This tells you what you got.

Point it at the dataset of any run — from any Actor — and it returns the receipt:
how many records were duplicates, how many ignored the filters you asked for,
and **what a usable record really cost you**.

## Why

Across the Apify Store the same complaint keeps coming back, in the reviews of
tools that otherwise work fine:

> *"I expected 2,000 results for $10. I got 748 unique ones. That's $0.01337 per
> unique job, not the $0.005 advertised — 2.67 times the price."*

That user did the arithmetic by hand, in a review box. This Actor does it for
anyone, in about a second.

## What it gives you

- **Duplicates** — how many, and exactly which keys repeat
- **Unmet criteria** — records that ignored the filters you set (date windows,
  minimum thresholds, required fields)
- **Empty fields** — how often each field came back blank
- **Cost per usable record** — what you paid divided by what you can actually use
- **A live Excel receipt** — input cell at the top, real formulas underneath.
  Change the amount you paid and every figure recalculates. It is a working
  model, not a screenshot.

## Input

| Field | Meaning |
|---|---|
| `datasetId` | The dataset to audit. Pick it from the list — that grants read access to that dataset only. |
| `dedupeKeys` | Fields that identify one record, e.g. `["jobId"]`. Empty compares whole rows. |
| `filters` | What you had asked for, e.g. `[{"field":"postedAt","op":"after","value":"2026-07-01"}]` |
| `amountPaidUsd` | What that run cost you, from your Apify console |
| `locale` | `en` or `it` — the language of the Excel receipt |

Operators: `nonEmpty`, `equals`, `oneOf`, `min`, `max`, `after`, `before`, `matches`.

A field that is **missing counts as a failure**, not as a case to skip: that is
precisely the record you believed you had excluded when you paid.

## What it does NOT do

Said plainly, because the absence of this section is why tools get 3 stars:

- **It does not read your account.** It runs with limited permissions and can
  only see the one dataset you select. Not your other runs, not your other
  storages, not your billing.
- **It cannot read the run's cost by itself.** Apify does not expose that to a
  limited-permission Actor, so you type the amount in. If you leave it out, you
  still get duplicates and unmet criteria — just no cost per record.
- **It does not judge whether the data is true.** It checks the data against the
  criteria you declare. If a scraper invents a plausible email, this will not
  know — it will only tell you the field was not empty.
- **It does not compare across runs.** Duplicates are counted inside one dataset.
  If the same record was sold to you in two separate runs, that is not caught yet.
- **It does not store anything.** Your rows are read, counted, and dropped. The
  only output is on your own account.

## Cost

Free. If it ever stops being free you will read about it here first, with the
notice period the platform requires.

---

Built by [ledgerworks](https://apify.com/ledgerworks) — financial tools that get
the numbers right. Same workshop as
[13-Week Cash Flow](https://apify.com/ledgerworks/cashflow13).

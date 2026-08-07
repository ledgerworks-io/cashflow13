# Lead Adjudicator — pay only for what we can prove

You bought 5,000 records. You paid for 5,000. Then you opened the file and found
1,200 with no email, 900 outside the region you asked for, 400 duplicates and
600 `info@` addresses instead of people.

You paid for 5,000. You can use 1,900. Nobody promised you anything you could
check.

This Actor gives you a **verdict for every record**, against the criteria *you*
declared — and a live Excel receipt with the one number that matters: what you
actually paid per usable record.

## What it checks

| Column | What it decides |
|---|---|
| **The field you asked for is empty** | Certain, always |
| **A criterion you declared is not met** | Certain, always |
| **This record is a duplicate of an earlier one** | Certain, always |
| **The email cannot receive mail** | Dead domains, throwaway services, role addresses and typos: certain. Whether a specific mailbox exists: **we say we don't know** |

## The pricing, in full

> **$0.005 per record we can adjudicate.**
> **The first 200 adjudicated records of every run are free — always.**
> **Never more than $1.50 per 1,000 records you gave us.**

Every one of those three numbers is checkable against figures printed in your
receipt. Nothing here asks you to take our word for it.

Three consequences worth stating plainly:

1. **Records we cannot adjudicate are free.** If we cannot prove a verdict, you
   do not pay for that record. The receipt marks every one of them, so you can
   check we applied it.
2. **On the B2B list we measured, this works out to about $0.000875 per record
   you gave us** — about a sixth of what the same list would cost if we billed
   every record we delivered — because most of that list falls into "we don't
   know" on the email column and we do not bill it. Your list will differ: the
   more of it we can adjudicate, the more you pay, up to $0.005 per record, and
   never past the cap above.
3. **Nothing here will ever be taken away.** The free allowance is permanent,
   not a trial. There is no future day on which this becomes more expensive
   than it says today.

### Two numbers, and you pay the lower

We work out what you owe twice, and charge whichever comes out smaller:

- **By the record**: `(records we adjudicated − 200 free) × $0.005`
- **By the size of the job**: `records you gave us ÷ 1000 × $1.50`

That second figure is a ceiling, not a price — it is there so that a very clean
list cannot end up costing more to check than it is worth. It is worked out on
the records **you** handed us, which we count in front of you: there is no
figure you have to declare, and nothing you could declare that would change it.

| You give us | We can adjudicate | By the record | Ceiling | **You pay** |
|---:|---:|---:|---:|---:|
| 999 | 174 (17%) | $0.00 | $1.50 | **$0.00** |
| 5,000 | 875 (17%) | $3.38 | $7.50 | **$3.38** |
| 5,000 | 3,175 (64%) | $14.88 | $7.50 | **$7.50** |
| 100,000 | 17,500 (17%) | $86.50 | $150.00 | **$86.50** |

The first row is free because 174 adjudicated records all sit inside the 200
you get free every run — not because of the ceiling. On a typical B2B list,
runs below about 1,100 records cost nothing at all.

The price shown is the one that applies on Apify's **Free** plan. If your
account is on a higher plan, Apify's own tier discount applies and you pay
**less** than the figure above — never more.

## What you get back

- **A live Excel workbook.** Real formulas, not a picture of numbers: the totals
  are `COUNTIF`s over the per-record verdicts, so you can re-do our arithmetic
  in front of us. Change the amount you paid in the yellow cell and every figure
  recalculates.
- **A dataset with one row per record**: position in your file, verdict, whether
  it was charged, and why.

## What it does not do

It does not scrape, enrich, or look anything up about the people in your file.
It reads the records you give it, compares them to the criteria you declare, and
returns a verdict. Nothing is stored: there is no database, and the workbook is
held only for the life of the run.

## Input

| Field | Required | What it is |
|---|---|---|
| `datasetId` | no | The dataset to adjudicate. Read-only access, that dataset only. **Leave empty to run a free built-in demo** and see what you get back. |
| `filters` | no | The criteria you asked for, e.g. `[{"field":"region","op":"equals","value":"Lombardia"}]` |
| `dedupeKeys` | no | Fields that identify one record, e.g. `["email"]` |
| `emailField` | no | Name of the email field, to turn on the email column |
| `amountPaidUsd` | no | What you paid for the data. Used only to show your real cost per usable record. **It has no effect on what you are charged.** |
| `locale` | no | `en` or `it` |

## Privacy

This tool reads only the dataset you point it at, and has no access to anything
else in your account. It keeps nothing after the run. When the email column is
enabled, only the **domain** part of each address is sent to a DNS resolver —
never the part that identifies the person.

A data processing agreement is available on request.

---

Built by [ledgerworks](https://apify.com/ledgerworks). Source: BUSL-1.1.

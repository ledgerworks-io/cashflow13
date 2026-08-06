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
> **We never charge more than half of what you tell us you paid for the data.**

Three consequences worth stating plainly:

1. **Records we cannot adjudicate are free.** If we cannot prove a verdict, you
   do not pay for that record. The receipt marks every one of them, so you can
   check we applied it.
2. **On the B2B list we measured, this works out to about $0.000875 per record
   you gave us** — about a sixth of what the same list would cost if we billed
   every record we delivered — because most of that list falls into "we don't
   know" on the email column and we do not bill it. Your list will differ: the
   more of it we can adjudicate, the more you pay, up to $0.005 per record, and
   never more than half of what you tell us the data cost.
3. **Nothing here will ever be taken away.** The free allowance is permanent,
   not a trial. There is no future day on which this becomes more expensive
   than it says today.

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
| `datasetId` | yes | The dataset to adjudicate. Read-only access, that dataset only. |
| `filters` | no | The criteria you asked for, e.g. `[{"field":"region","op":"equals","value":"Lombardia"}]` |
| `dedupeKeys` | no | Fields that identify one record, e.g. `["email"]` |
| `emailField` | no | Name of the email field, to turn on the email column |
| `amountPaidUsd` | no | What you paid. Produces cost per usable record, and activates the 50% cap. |
| `locale` | no | `en` or `it` |

## Privacy

This tool reads only the dataset you point it at, and has no access to anything
else in your account. It keeps nothing after the run. When the email column is
enabled, only the **domain** part of each address is sent to a DNS resolver —
never the part that identifies the person.

A data processing agreement is available on request.

---

Built by [ledgerworks](https://apify.com/ledgerworks). Source: BUSL-1.1.

# 13-Week Cash Flow Forecast

Answers the question people actually open a cash flow tool to ask:
**which week does the cash go negative, and by how much?**

Six figures in — opening cash balance, expected receipts, supplier payments,
payroll, loan instalments, and VAT or taxes due. Out comes the 13-week grid,
the break-even week, the peak funding need across the period, the levers that
would move the date, and a **live Excel workbook** with real formulas you can
keep working in.

Don't know your receipts? Give revenue and DSO instead and it converts. Same
for purchases and DPO on the payables side. One number per line if your weeks
are flat, thirteen if you have the detail.

---

## Three ways to use it

### 1. Desktop extension — nothing leaves your machine

The best version, and the one to pick if the figures are a client's.
The server runs locally and writes the workbook straight to your disk. No
account, no token, no upload.

Download **`cashflow13-*.mcpb`** from
[Releases](https://github.com/ledgerworks-io/cashflow13/releases),
then in Claude Desktop: Settings → Extensions → drag the file in.

### 2. Remote server — the shortest path

No account and no token. In Claude Desktop, Settings → Connectors → Add custom
connector:

```
https://mcp.chiriba.it/mcp
```

In Claude Code:

```bash
claude mcp add --transport http cashflow13 https://mcp.chiriba.it/mcp
```

Listed in the official MCP registry as **`it.chiriba/cashflow13`**.

### 3. Apify Actor

Apify Standby requires **your own Apify API token** — that is the platform's
rule, not ours. Append it to the URL:

```
https://ledgerworks--cashflow13.apify.actor/mcp?token=YOUR_APIFY_TOKEN
```

If you would rather not have an account at all, use one of the two above.

---

## What it gives back

- the week-by-week grid with the closing cash balance
- **the first week the balance turns negative**, and the shortfall in that week
- the **peak funding need** over the 13 weeks — the cumulative low point, which
  is a different number from the first shortfall, and the one your bank will ask for
- levers, each with the weeks it buys and the change in funding need:
  collecting 15 days earlier, paying suppliers 15 days later, moving payroll a week

The levers never make an outflow disappear. Moving payroll a week pushes the
last payment past week 13, and the answer says so — deferred, not saved.

## The workbook

Yellow cells are inputs. Everything else is a formula. Change a weekly figure
and the grid, the break-even week and the funding need all move; change the
start date in one cell and all thirteen weeks follow. It recalculates on open,
because no cached values are written — it is the model, not a picture of one.

Weeks end on **Friday** by default: US practice, and where payroll and bank
cut-offs fall. Configurable, and written into the workbook header so whoever
receives the file knows what convention they are reading.

## Your figures

No database, no history, no account, nothing kept.

- **Desktop extension** — the numbers never leave your computer.
- **Remote server** — the workbook is held in memory for 60 minutes, never
  written to disk, then forgotten.
- **Apify** — the workbook sits on Apify's storage for at most 20 minutes,
  then is deleted whether it was downloaded or not.

---

## Development

```bash
npm install
npm test          # tests are written before the code
npm run typecheck
npm run build
npm run bundle    # builds the .mcpb desktop extension
npm run release   # full release chain; stops before anything leaves the machine
```

| Path | What lives there |
|---|---|
| `src/engine/calendar.ts` | The 13 week-ending dates, all in UTC |
| `src/engine/plan.ts` | The grid, the first negative week, the peak funding need |
| `src/engine/levers.ts` | What would move the date |
| `src/engine/working-capital.ts` | Revenue + DSO → weekly receipts |
| `src/excel/workbook.ts` | The live workbook |
| `src/delivery/` | How the file reaches you, and **why** each way exists |
| `src/i18n/strings.ts` | **The localization table.** Every user-facing label. |

### Rules that shaped this

- **No user-facing string is hardcoded** — it goes in the localization table, in
  English and Italian. A test fails if a key is missing a language, or if an
  Italian string is a copy-paste of the English.
- **Tests before code.** For a financial tool, correctness *is* the product.
  A balance of exactly zero is not negative. Money rounds to the cent at every
  step, because `0.1 + 0.2` does not make `0.3` and a plan that says "you are
  overdrawn" when you are not is worse than no plan.
- **No storage.** That is also the GDPR answer.
- **One engine, many tools.** The next tools are new functions on this server,
  not new projects.

## Licence

[Business Source License 1.1](LICENSE). In plain terms:

- **Use it for anything**, including your own professional work — an accountant
  or controller running this for a client, and billing that client, is fine.
- **You may not hand it to third parties for a fee so they can use it
  themselves** — not as a product, not as a hosted service, not embedded in
  other software.
- Four years after each version is published, that version becomes
  **Apache 2.0** and the restriction lapses.

Not OSI-approved, deliberately: the tool is free to use and stays free to use,
but the option to charge for it later is kept open.
For other arrangements: `info@chiriba.com`.

# cashflow13

MCP server for a **13-week cash flow plan**. Six inputs in, a survival calendar out —
including the one number people open the tool for: **the week cash goes negative, and by
how much.**

Status: **under construction.** Live and serving. The calendar, the grid, the
break-even detection and the working-capital conversion are written and tested.
The six inputs are not yet wired to the tool — the workbook it hands back today
uses placeholder figures, with real formulas in real cells.

## Install

Listed in the official MCP registry as **`it.chiriba/cashflow13`**.

**Claude Desktop** — Settings → Connectors → Add custom connector, URL below.

**Claude Code**

```bash
claude mcp add --transport http cashflow13 https://mcp.chiriba.it/mcp
```

## Endpoint

```
https://mcp.chiriba.it/mcp
```

Streamable HTTP, stateless. Nothing is stored — the server computes and returns.

```bash
curl -X POST https://mcp.chiriba.it/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"health","arguments":{"locale":"en"}}}'
```

## Development

```bash
npm install
npm test          # vitest — tests are written before the code
npm run typecheck
npm run build
npm start
```

## Layout

| Path | What lives there |
|---|---|
| `src/index.ts` | HTTP host: Express, `/mcp`, `/download/:key`, `/healthz` |
| `src/server.ts` | MCP instance and tool registration |
| `src/engine/calendar.ts` | The 13 week-ending dates. Weeks end on **Friday** by default. |
| `src/engine/plan.ts` | The grid, the first negative week, the peak funding need |
| `src/engine/working-capital.ts` | Revenue + DSO → weekly receipts (and purchases + DPO) |
| `src/excel/workbook.ts` | The live workbook: input cells on top, real formulas below |
| `src/delivery/store.ts` | Temporary download links, and **why** they exist |
| `src/i18n/strings.ts` | **The localization table.** Every user-facing label. |
| `test/` | Protocol-level and engine tests |

### Rules that shaped this

- **No user-facing string is hardcoded.** It goes in `src/i18n/strings.ts`, in English
  and Italian, from the first commit. A test fails if a key is missing a language — or
  if an Italian string is a copy-paste of the English one.
- **Tests before code.** For a financial tool, correctness *is* the product.
- **No storage.** No database, no session state, no history. That is also the GDPR answer.
- **One engine, many tools.** The next tools (PDF → Excel, business plan, XBRL) are new
  functions on this server, not new projects.

## Deployment

- systemd unit `cashflow13.service`, running as the unprivileged `cashflow13` user
- listens on `127.0.0.1:8770` only; Caddy terminates TLS and routes by path
- the service cannot write to its own code (files are root-owned, `ProtectSystem=strict`)

## Licence

[Business Source License 1.1](LICENSE). In plain terms:

- **Use it for anything**, including in your own professional work — an accountant
  or controller running this for a client, and billing that client, is fine.
- **You may not hand it to third parties for a fee so they can use it themselves** —
  not as a product, not as a hosted service, not embedded in other software.
- Four years after each version is published, that version becomes
  **Apache 2.0** and the restriction lapses.

BUSL-1.1 is not an OSI-approved licence. That is deliberate: the tool is free to
use, and stays free to use, but the option to charge for it later is kept open.
For other arrangements: `info@chiriba.com`.

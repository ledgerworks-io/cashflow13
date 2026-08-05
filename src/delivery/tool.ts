import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MissingInputsError, normalizeInputs } from "../engine/inputs.js";
import { buildPlan } from "../engine/plan.js";
import { generateWorkbook } from "../excel/workbook.js";
import { SUPPORTED_LOCALES, resolveLocale, t } from "../i18n/index.js";
import { deposito } from "./store.js";

export const NOME_FILE = "cashflow13-plan.xlsx";
export const BASE_PUBBLICA = process.env.BASE_PUBBLICA ?? "https://mcp.chiriba.it";

/** Un numero (uguale ogni settimana) oppure tredici. */
const flusso = z.union([z.number(), z.array(z.number()).length(13)]);

const soldi = (etichetta: string) =>
  flusso.optional().describe(`${etichetta}. One number for every week, or 13 weekly values.`);

/** Griglia leggibile in chat: il file richiede di uscire dalla conversazione,
 *  la risposta no. Markdown perche' si vede in ogni client, App o non App. */
function tabella(plan: ReturnType<typeof buildPlan>, currency: string): string {
  const n = (v: number) =>
    v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const righe = plan.weeks.map((w) =>
    `| ${w.week} | ${w.weekEnding.toISOString().slice(0, 10)} | ${n(w.opening)} | ` +
    `${n(w.receipts)} | ${n(-(w.supplierPayments + w.payroll + w.loanRepayments + w.taxes))} | ` +
    `**${n(w.closing)}**${w.closing < 0 ? " ⚠️" : ""} |`,
  );
  return [
    `| Wk | Ending | Opening | In | Out | Closing (${currency}) |`,
    "|---:|---|---:|---:|---:|---:|",
    ...righe,
  ].join("\n");
}

export function registraStrumentoCartella(server: McpServer): void {
  server.registerTool(
    "build_cashflow_plan",
    {
      title: "13-Week Cash Flow Plan",
      description:
        t("tool.workbook.description") +
        " Ask the user for the figures one at a time; call the tool once you have " +
        "the opening balance plus receipts and supplier payments — payroll, loans " +
        "and taxes default to zero if not given.",
      inputSchema: {
        openingBalance: z.number().optional()
          .describe("Cash in the bank on day one. Required."),
        startDate: z.string().optional()
          .describe("First day of the plan, YYYY-MM-DD. Defaults to today."),

        receipts: soldi("Cash expected in from customers"),
        revenue: soldi("Revenue, if receipts are not known directly (needs dsoDays)"),
        dsoDays: z.number().optional()
          .describe("Days sales outstanding, used with revenue."),
        openingReceivables: z.number().optional()
          .describe("Receivables open on day one. Optional; sharpens the DSO conversion."),

        supplierPayments: soldi("Cash out to suppliers"),
        purchases: soldi("Purchases, if payments are not known directly (needs dpoDays)"),
        dpoDays: z.number().optional()
          .describe("Days payable outstanding, used with purchases."),
        openingPayables: z.number().optional()
          .describe("Payables open on day one. Optional."),

        payroll: soldi("Wages and salaries"),
        loanRepayments: soldi("Loan and lease instalments"),
        taxes: soldi("VAT and taxes falling due"),

        weekEndsOn: z.number().int().min(0).max(6).optional()
          .describe("Day weeks close on: 0=Sunday … 5=Friday (default), 6=Saturday."),
        currency: z.string().optional().describe("Currency label, e.g. EUR. Label only."),
        locale: z.enum(SUPPORTED_LOCALES).optional(),
      },
    },
    async (args) => {
      const lang = resolveLocale(args.locale);
      const currency = args.currency ?? "EUR";

      let plan;
      try {
        plan = buildPlan(normalizeInputs(args));
      } catch (err) {
        if (err instanceof MissingInputsError) {
          // Non un errore secco: si dice cosa manca, cosi' l'assistente sa
          // quale domanda fare dopo invece di ripeterle tutte.
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Still needed before I can build the plan: ${err.missing.join(", ")}.`,
            }],
            structuredContent: { missing: err.missing },
          };
        }
        throw err;
      }

      const dati = await generateWorkbook(plan, { currency });
      const { key, expiresAt } = deposito.put(dati, NOME_FILE);

      const payload = {
        firstNegativeWeek: plan.firstNegativeWeek,
        firstNegativeWeekEnding: plan.firstNegativeWeek
          ? plan.weeks[plan.firstNegativeWeek - 1]!.weekEnding.toISOString().slice(0, 10)
          : null,
        shortfallAtFirstNegative: plan.shortfallAtFirstNegative,
        peakFundingNeed: plan.peakFundingNeed,
        lowestClosingBalance: plan.lowestClosingBalance,
        weekEndsOn: plan.weekEndsOn,
        currency,
        weeks: plan.weeks.map((w) => ({
          week: w.week,
          weekEnding: w.weekEnding.toISOString().slice(0, 10),
          opening: w.opening,
          receipts: w.receipts,
          supplierPayments: w.supplierPayments,
          payroll: w.payroll,
          loanRepayments: w.loanRepayments,
          taxes: w.taxes,
          netMovement: w.netMovement,
          closing: w.closing,
        })),
        downloadUrl: `${BASE_PUBBLICA}/download/${key}`,
        filename: NOME_FILE,
        expiresAt: new Date(expiresAt).toISOString(),
      };

      const titolo = plan.firstNegativeWeek === null
        ? `Cash stays positive for all 13 weeks. Lowest point: ${plan.lowestClosingBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency} in week ${plan.weeks.reduce((a, b) => (b.closing < a.closing ? b : a)).week}.`
        : `**Cash goes negative in week ${plan.firstNegativeWeek}** (${payload.firstNegativeWeekEnding}), at ${plan.shortfallAtFirstNegative!.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}. Peak funding need over the 13 weeks: **${plan.peakFundingNeed.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}**.`;

      const testo = [
        titolo,
        "",
        tabella(plan, currency),
        "",
        t("tool.workbook.ready", lang),
        payload.downloadUrl,
        "",
        t("tool.workbook.hint", lang),
      ].join("\n");

      return {
        content: [{ type: "text" as const, text: testo }],
        structuredContent: payload,
      };
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { XLSX_MIME, generaCartella } from "../excel/workbook.js";
import { SUPPORTED_LOCALES, resolveLocale, t } from "../i18n/index.js";
import { deposito } from "./store.js";

export const NOME_FILE = "cashflow13-plan.xlsx";

/** Sovrascrivibile per il collaudo; in produzione e' l'host pubblico. */
export const BASE_PUBBLICA = process.env.BASE_PUBBLICA ?? "https://mcp.chiriba.it";

export function registraStrumentoCartella(server: McpServer): void {
  server.registerTool(
    "cashflow_workbook_preview",
    {
      title: "13-Week Cash Flow workbook (preview)",
      description:
        `${t("tool.workbook.description")} PREVIEW: figures are placeholders — ` +
        "the six inputs become parameters when the engine lands.",
      inputSchema: {
        locale: z
          .enum(SUPPORTED_LOCALES)
          .optional()
          .describe("Language for human-readable labels. Defaults to English."),
      },
    },
    async ({ locale }) => {
      const lang = resolveLocale(locale);
      const dati = await generaCartella();
      const { key, expiresAt } = deposito.put(dati, NOME_FILE);

      const payload = {
        downloadUrl: `${BASE_PUBBLICA}/download/${key}`,
        filename: NOME_FILE,
        sizeKb: Number((dati.length / 1024).toFixed(1)),
        expiresAt: new Date(expiresAt).toISOString(),
        expiresInMinutes: Math.round((expiresAt - Date.now()) / 60000),
        weekEndsOn: "Friday",
      };

      // Il testo conta: il client non sa materializzare un binario, quindi
      // l'utente deve capire dal testo cosa fare. Non e' decorazione.
      const testo =
        `${t("tool.workbook.ready", lang)}\n\n` +
        `${payload.downloadUrl}\n\n` +
        `${t("tool.workbook.hint", lang)}`;

      return {
        content: [{ type: "text" as const, text: testo }],
        structuredContent: payload,
      };
    },
  );
}

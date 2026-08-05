import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  t,
} from "./i18n/index.js";
import { registraStrumentoCartella } from "./delivery/tool.js";
import { VERSION } from "./version.js";

/**
 * Costruisce l'istanza MCP.
 *
 * Una funzione e non un singleton: il trasporto HTTP e' senza stato e crea un
 * server per richiesta, cosi' due chiamate in parallelo non si pestano i piedi.
 * Qui dentro non si archivia niente — calcolo e restituzione, il problema GDPR
 * si risolve non avendo dati.
 *
 * Il motore del piano di cassa entrera' come strumenti aggiuntivi su questa
 * stessa istanza: un solo motore, piu' strumenti sopra.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "cashflow13",
      version: VERSION,
    },
    {
      instructions:
        "Builds a 13-week cash flow plan: week-by-week closing balance, the week " +
        "cash goes negative, peak funding need, and a live Excel workbook with " +
        "real formulas. Ask the user for the inputs one question at a time.",
    },
  );

  server.registerTool(
    "health",
    {
      title: "Health",
      description: t("tool.health.description", DEFAULT_LOCALE),
      inputSchema: {
        locale: z
          .enum(SUPPORTED_LOCALES)
          .optional()
          .describe("Language for human-readable labels. Defaults to English."),
      },
    },
    async ({ locale }) => {
      const lang = resolveLocale(locale);
      const payload = {
        status: "ok" as const,
        message: t("tool.health.ok", lang),
        service: "cashflow13",
        version: VERSION,
        locale: lang,
        supportedLocales: [...SUPPORTED_LOCALES],
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  registraStrumentoCartella(server);

  return server;
}

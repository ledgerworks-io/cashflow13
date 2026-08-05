import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";

import { deposito } from "./delivery/store.js";
import { XLSX_MIME } from "./excel/workbook.js";
import { t } from "./i18n/index.js";
import { createMcpServer } from "./server.js";
import { PACKAGE_NAME, VERSION } from "./version.js";

// Su Apify la porta la decide la piattaforma; sul nostro VPS e' la 8770.
const PORT = Number(process.env.ACTOR_WEB_SERVER_PORT ?? process.env.PORT ?? 8770);

// Sul VPS si ascolta solo in locale: davanti c'e' Caddy, che fa TLS e instrada
// per percorso, e il servizio non dev'essere raggiungibile direttamente.
// In un contenitore invece bisogna esporsi, o la piattaforma non ci arriva.
const IN_CONTENITORE = process.env.ACTOR_WEB_SERVER_PORT !== undefined;
const HOST = process.env.HOST ?? (IN_CONTENITORE ? "0.0.0.0" : "127.0.0.1");

const app = express();

// Apify tiene l'attore in Standby e prima di mandargli traffico chiede se e'
// pronto, con questa intestazione. Va risposto subito e su qualunque percorso:
// se non si risponde, l'attore resta fermo e nessuno capisce perche'.
app.use((req: Request, res: Response, next) => {
  if (req.headers["x-apify-container-server-readiness-probe"] !== undefined) {
    res.status(200).type("text/plain").send("ok");
    return;
  }
  next();
});
// Express annuncia se stesso con `X-Powered-By`: e' informazione regalata a chi
// cerca bersagli, e non serve a nessun client.
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

/**
 * Ritiro della cartella Excel.
 *
 * Questa rotta esiste perche' il protocollo MCP non riesce a consegnare un
 * binario: il client rifiuta sia le risorse incorporate sia i collegamenti a
 * risorsa (provato il 2026-08-05, vedi delivery/store.ts). Un URL invece passa,
 * perche' per il protocollo e' testo e lo scaricamento lo fa il browser.
 */
app.get("/download/:chiave", async (req: Request, res: Response) => {
  const chiave = req.params.chiave;
  const id = typeof chiave === "string" ? chiave : "";
  const voce = await deposito.get(id);
  if (!voce) {
    // 410 e non 404: la risorsa e' esistita ed e' scaduta. E il messaggio deve
    // dire all'utente cosa fare, non lasciarlo davanti a un errore secco.
    res.status(410).type("text/plain; charset=utf-8").send(
      `${t("error.link_expired", "en")}\n${t("error.link_expired", "it")}\n`,
    );
    return;
  }
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${voce.filename}"`,
  );
  res.setHeader("Content-Length", String(voce.data.length));
  // Il file contiene numeri dell'utente dietro un URL pubblico: niente cache
  // condivisa, ne' sul proxy ne' sull'edge.
  res.setHeader("Cache-Control", "no-store, private");
  res.end(voce.data);
  // NON si cancella dopo la consegna, per quanto sia allettante toglierlo dal
  // disco di Apify un'ora prima. Un link monouso lo brucia il primo che lo
  // tocca — il prefetch del browser, un antivirus aziendale che ispeziona i
  // collegamenti — e l'utente trova un errore senza aver scaricato niente.
  // L'esposizione la limita il TTL, che è un secondo dopo l'altro sotto
  // controllo; la consegna che fallisce no.
});

// Sonda per systemd e per un controllo a occhio. Non fa parte del protocollo MCP.
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: PACKAGE_NAME, version: VERSION });
});

/**
 * Endpoint MCP, trasporto Streamable HTTP in modalita' SENZA STATO.
 *
 * Un server e un trasporto nuovi a ogni richiesta, chiusi appena la risposta e'
 * partita: nessuna sessione in memoria, nessuna coda di eventi, niente che
 * cresca. E' la scelta giusta finche' lo strumento calcola e restituisce;
 * quando servira' lo streaming di lavori lunghi si passera' alle sessioni.
 */
app.post("/mcp", async (req: Request, res: Response) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] richiesta fallita:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Senza sessioni non c'e' niente da riprendere ne' da cancellare: si risponde
// 405 invece di lasciare che il client resti appeso su una GET che non arrivera'.
const noSession = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: server is stateless" },
    id: null,
  });
};
app.get("/mcp", noSession);
app.delete("/mcp", noSession);

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[${PACKAGE_NAME} ${VERSION}] in ascolto su http://${HOST}:${PORT}/mcp`);
});

// systemd manda SIGTERM: si chiude pulito, senza troncare una risposta in corso.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[${PACKAGE_NAME}] ${signal} ricevuto, chiusura`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { deliverToDisk } from "./delivery/local.js";
import { createMcpServer } from "./server.js";
import { PACKAGE_NAME, VERSION } from "./version.js";

/**
 * Ingresso per l'estensione desktop (MCPB).
 *
 * Qui il server gira sulla macchina dell'utente e parla stdio. Due conseguenze
 * che valgono piu' della comodita' di installazione:
 *
 *  - i numeri non escono dal suo computer. Per uno strumento che tratta la
 *    cassa di un'azienda e' un argomento, non un dettaglio.
 *  - la cartella Excel si scrive su disco e si da' il percorso. Sparisce del
 *    tutto l'aggiramento del link temporaneo, che esiste solo perche' un server
 *    remoto non riesce a passare un binario dentro il protocollo MCP.
 *
 * IMPORTANTE: su stdio il canale e' il protocollo. Qualunque cosa scritta su
 * stdout corrompe i messaggi JSON-RPC. Le diagnostiche vanno su stderr.
 */
async function main(): Promise<void> {
  const server = createMcpServer(deliverToDisk);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${PACKAGE_NAME} ${VERSION}] pronto su stdio`);
}

main().catch((err: unknown) => {
  console.error("[cashflow13] avvio fallito:", err);
  process.exit(1);
});

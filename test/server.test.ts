import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { VERSION } from "../src/version.js";

/**
 * I test parlano il protocollo vero attraverso un trasporto in memoria, non
 * chiamano le funzioni interne: se il collegamento MCP si rompe, si rompe qui.
 */
let client: Client;
let closeAll: () => Promise<void>;

beforeEach(async () => {
  const server = createMcpServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  closeAll = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await closeAll();
});

describe("collegamento MCP", () => {
  it("si presenta con nome e versione del pacchetto", () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe("cashflow13");
    expect(info?.version).toBe(VERSION);
  });

  it("dichiara la capacità tools", () => {
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });
});

describe("tools/list", () => {
  it("espone lo strumento health", async () => {
    const { tools } = await client.listTools();
    const nomi = tools.map((t) => t.name);
    expect(nomi).toContain("health");
  });

  it("ogni strumento ha una descrizione non vuota", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("tools/call health", () => {
  it("risponde ok, in inglese quando la lingua non è indicata", async () => {
    const res = await client.callTool({ name: "health", arguments: {} });

    expect(res.isError).toBeFalsy();
    const payload = res.structuredContent as Record<string, unknown>;
    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("cashflow13");
    expect(payload.version).toBe(VERSION);
    expect(payload.locale).toBe("en");
    expect(payload.message).toBe("Server is running.");
  });

  it("risponde in italiano quando richiesto", async () => {
    const res = await client.callTool({
      name: "health",
      arguments: { locale: "it" },
    });

    const payload = res.structuredContent as Record<string, unknown>;
    expect(payload.locale).toBe("it");
    expect(payload.message).toBe("Il server è in funzione.");
  });

  it("elenca le lingue supportate", async () => {
    const res = await client.callTool({ name: "health", arguments: {} });
    const payload = res.structuredContent as Record<string, unknown>;
    expect(payload.supportedLocales).toEqual(["en", "it"]);
  });

  it("il contenuto testuale rispecchia quello strutturato", async () => {
    const res = await client.callTool({
      name: "health",
      arguments: { locale: "it" },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe("text");
    expect(JSON.parse(content[0]!.text)).toEqual(res.structuredContent);
  });

  it("rifiuta una lingua non supportata invece di inventarla", async () => {
    const res = await client.callTool({
      name: "health",
      arguments: { locale: "de" },
    });
    // Lo schema dichiara un enum: la validazione deve scattare a monte.
    expect(res.isError).toBe(true);
  });
});

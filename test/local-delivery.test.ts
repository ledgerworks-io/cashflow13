import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deliverToDisk } from "../src/delivery/local.js";

let cartella: string;
const precedente = process.env.CASHFLOW13_OUTPUT_DIR;

beforeEach(async () => {
  cartella = await mkdtemp(join(tmpdir(), "cf13-"));
  process.env.CASHFLOW13_OUTPUT_DIR = cartella;
});

afterEach(async () => {
  if (precedente === undefined) delete process.env.CASHFLOW13_OUTPUT_DIR;
  else process.env.CASHFLOW13_OUTPUT_DIR = precedente;
  await rm(cartella, { recursive: true, force: true });
});

describe("consegna su disco", () => {
  it("scrive il file e restituisce il percorso assoluto", async () => {
    const d = await deliverToDisk(Buffer.from("ciao"), "piano.xlsx");
    expect(d.kind).toBe("file");
    expect(d.location).toBe(join(cartella, "piano.xlsx"));
    expect(readFileSync(d.location, "utf8")).toBe("ciao");
  });

  it("non ha scadenza: in locale non c'è niente da far scadere", async () => {
    const d = await deliverToDisk(Buffer.from("x"), "piano.xlsx");
    expect(d.expiresAt).toBeUndefined();
  });

  it("NON sovrascrive un file già presente", async () => {
    // Chi rifà il piano tre volte vuole tre file, non scoprire che il primo
    // è sparito mentre lo stava ancora guardando.
    const a = await deliverToDisk(Buffer.from("primo"), "piano.xlsx");
    const b = await deliverToDisk(Buffer.from("secondo"), "piano.xlsx");
    const c = await deliverToDisk(Buffer.from("terzo"), "piano.xlsx");

    expect(new Set([a.location, b.location, c.location]).size).toBe(3);
    expect(readFileSync(a.location, "utf8")).toBe("primo");
    expect(b.location).toBe(join(cartella, "piano-2.xlsx"));
    expect(c.location).toBe(join(cartella, "piano-3.xlsx"));
  });

  it("conserva l'estensione quando numera", async () => {
    await deliverToDisk(Buffer.from("a"), "cashflow13-plan.xlsx");
    const b = await deliverToDisk(Buffer.from("b"), "cashflow13-plan.xlsx");
    expect(b.location.endsWith(".xlsx")).toBe(true);
    expect(b.location).toContain("cashflow13-plan-2");
  });

  it("crea la cartella se non esiste", async () => {
    const nuova = join(cartella, "una", "due");
    process.env.CASHFLOW13_OUTPUT_DIR = nuova;
    const d = await deliverToDisk(Buffer.from("x"), "piano.xlsx");
    expect(existsSync(d.location)).toBe(true);
  });

  it("scrive byte identici a quelli ricevuti", async () => {
    const binario = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe]);
    const d = await deliverToDisk(binario, "piano.xlsx");
    expect(readFileSync(d.location).equals(binario)).toBe(true);
  });
});

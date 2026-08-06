import { describe, expect, it } from "vitest";

import {
  MAX_DATASET_POST_BYTES,
  chunkForDataset,
  priceFromRunOrActor,
} from "../src/adjudicate/platform.js";
import type { ApifyPricingInfo } from "../src/adjudicate/billing.js";

/**
 * Le decisioni che riguardano la piattaforma.
 *
 * Esistono come modulo separato perché il 6 agosto 2026 stavano dentro
 * `actor.ts`, che è escluso dal cancello di copertura in quanto punto
 * d'ingresso. Ma non erano idraulica: erano due decisioni commerciali, e
 * nessun test le guardava.
 *
 *  1. **Quanto grande può essere il corpo mandato al dataset.** Apify rifiuta
 *     oltre 9.437.184 byte con `413` e **non scrive niente**. `fetch` non
 *     lancia sui 4xx, quindi il codice dichiarava nei log di aver consegnato,
 *     non consegnava, e poi addebitava: la lamentela numero uno del negozio,
 *     commessa dallo strumento costruito per curarla.
 *  2. **Da dove si legge il prezzo applicato davvero.** Su un attore privato
 *     `currentPricingInfo` resta `null`, quindi la difesa contro il
 *     bait-and-switch non si era mai accesa nemmeno una volta.
 */

describe("il corpo mandato al dataset sta sotto il limite della piattaforma", () => {
  const riga = (i: number) => ({
    row: i,
    verdict: "rejected",
    charged: true,
    reasons: [{ code: "email", field: "email", detail: "publishes a null MX record (RFC 7505)" }],
    warnings: [],
  });

  it("il limite è quello misurato sull'API, non un numero tondo a caso", () => {
    // Testuale dalla risposta 413: «limit: 9437184 bytes». Misurato il
    // 6 agosto 2026 mandando un corpo da 14,3 MB: itemCount è restato 0.
    expect(MAX_DATASET_POST_BYTES).toBe(9_437_184);
  });

  it("nessun pezzo supera il limite, su un carico che da solo lo supererebbe", () => {
    const righe = Array.from({ length: 70_000 }, (_, i) => riga(i));
    // Controprova: in un colpo solo sarebbe oltre il limite.
    expect(Buffer.byteLength(JSON.stringify(righe), "utf8")).toBeGreaterThan(MAX_DATASET_POST_BYTES);

    const pezzi = chunkForDataset(righe);
    expect(pezzi.length).toBeGreaterThan(1);
    for (const [i, p] of pezzi.entries()) {
      expect(Buffer.byteLength(JSON.stringify(p), "utf8"), `pezzo ${i}`)
        .toBeLessThanOrEqual(MAX_DATASET_POST_BYTES);
    }
  });

  it("non si perde né si duplica una riga: i pezzi ricompongono l'originale", () => {
    const righe = Array.from({ length: 70_000 }, (_, i) => riga(i));
    const ricomposto = chunkForDataset(righe).flat();
    expect(ricomposto).toHaveLength(righe.length);
    expect(ricomposto.map((r) => r.row)).toEqual(righe.map((r) => r.row));
  });

  it("un carico piccolo resta in un pezzo solo: non si paga una richiesta in più", () => {
    expect(chunkForDataset(Array.from({ length: 300 }, (_, i) => riga(i)))).toHaveLength(1);
  });

  it("zero record: zero richieste, non una richiesta vuota", () => {
    expect(chunkForDataset([])).toEqual([]);
  });

  it("una riga che da sola supera il limite si dichiara, non si spedisce in silenzio", () => {
    // Non è divisibile: mandarla comunque significherebbe un 413 ignorato.
    const mostro = [{ row: 1, detail: "x".repeat(MAX_DATASET_POST_BYTES) }];
    expect(() => chunkForDataset(mostro)).toThrow(RangeError);
  });
});

describe("il prezzo applicato si legge dalla CORSA, non solo dall'attore", () => {
  const conFasce = (p: number): ApifyPricingInfo => ({
    pricingModel: "PAY_PER_EVENT",
    pricingPerEvent: {
      actorChargeEvents: {
        "record-adjudicated": {
          eventTieredPricingUsd: {
            FREE: { tieredEventPriceUsd: p },
            DIAMOND: { tieredEventPriceUsd: p / 2 },
          },
        },
      },
    },
  });
  const piatto = (p: number): ApifyPricingInfo => ({
    pricingModel: "PAY_PER_EVENT",
    pricingPerEvent: {
      actorChargeEvents: { "record-adjudicated": { eventPriceUsd: p } },
    },
  });

  it("la corsa ha la precedenza: è il prezzo risolto per la fascia di CHI CHIAMA", () => {
    // Apify appiattisce le fasce sul singolo `eventPriceUsd` valido per quella
    // corsa. È più vero della fascia FREE dell'attore, che vale per noi e non
    // per il cliente.
    const r = priceFromRunOrActor(piatto(0.003), conFasce(0.005), "record-adjudicated");
    expect(r.priceUsd).toBe(0.003);
    expect(r.source).toBe("run");
  });

  it("senza prezzo sulla corsa si ripiega sull'attore", () => {
    const r = priceFromRunOrActor(null, conFasce(0.005), "record-adjudicated");
    expect(r.priceUsd).toBe(0.005);
    expect(r.source).toBe("actor");
  });

  it("su un attore PRIVATO non si legge niente da nessuna delle due, e si dice", () => {
    // È lo stato misurato il 6 agosto 2026: `currentPricingInfo` resta null
    // finché l'attore è privato. Meglio dichiararlo che credere a un numero.
    const r = priceFromRunOrActor(null, null, "record-adjudicated");
    expect(r.priceUsd).toBeNull();
    expect(r.source).toBe("none");
  });

  it("un evento con un altro nome non vale: non si prende il prezzo di un altro", () => {
    const r = priceFromRunOrActor(piatto(0.003), conFasce(0.005), "un-altro-evento");
    expect(r.priceUsd).toBeNull();
    expect(r.source).toBe("none");
  });

  it("dall'attore si legge la fascia FREE, che è la più ALTA", () => {
    // Leggere la più bassa è la mossa che nelle recensioni si chiama
    // bait-and-switch: si mette in vetrina un prezzo che quasi nessuno paga.
    const r = priceFromRunOrActor(null, conFasce(0.005), "record-adjudicated");
    expect(r.priceUsd).toBe(0.005); // non 0.0025 della fascia DIAMOND
  });
});

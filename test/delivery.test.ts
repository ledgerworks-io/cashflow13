import { beforeEach, describe, expect, it } from "vitest";
import { DownloadStore } from "../src/delivery/store.js";

/**
 * L'orologio è iniettato: i test sul tempo non devono dipendere da timer veri,
 * altrimenti diventano lenti e traballanti.
 */
let adesso = 1_000_000;
const now = () => adesso;
const dati = (n = 100) => Buffer.alloc(n, 7);

let store: DownloadStore;

beforeEach(() => {
  adesso = 1_000_000;
  store = new DownloadStore({ ttlMs: 60_000, maxEntries: 3, maxTotalBytes: 1000, now });
});

describe("chiavi", () => {
  it("sono lunghe e non si ripetono", () => {
    const chiavi = new Set(
      Array.from({ length: 200 }, () => store.put(dati(), "a.xlsx").key),
    );
    expect(chiavi.size).toBe(200);
    for (const k of chiavi) expect(k.length).toBeGreaterThanOrEqual(32);
  });

  it("usano solo caratteri validi in un URL", () => {
    const { key } = store.put(dati(), "a.xlsx");
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("ritiro", () => {
  it("restituisce il file dentro la finestra", () => {
    const { key } = store.put(dati(42), "piano.xlsx");
    const v = store.get(key);
    expect(v?.filename).toBe("piano.xlsx");
    expect(v?.data.length).toBe(42);
  });

  it("si può scaricare PIÙ VOLTE dentro la finestra", () => {
    // Il monouso è ostile: un prefetch del browser brucerebbe il download.
    const { key } = store.put(dati(), "piano.xlsx");
    expect(store.get(key)).not.toBeNull();
    expect(store.get(key)).not.toBeNull();
    expect(store.get(key)).not.toBeNull();
  });

  it("scade allo scadere del TTL", () => {
    const { key } = store.put(dati(), "piano.xlsx");
    adesso += 59_999;
    expect(store.get(key)).not.toBeNull();
    adesso += 2;
    expect(store.get(key)).toBeNull();
  });

  it("una chiave inventata dà null, non un errore", () => {
    expect(store.get("chiave-che-non-esiste")).toBeNull();
    expect(store.get("")).toBeNull();
  });

  it("libera la memoria quando una voce scade", () => {
    const { key } = store.put(dati(500), "piano.xlsx");
    expect(store.totalBytes()).toBe(500);
    adesso += 60_001;
    store.get(key);
    expect(store.totalBytes()).toBe(0);
    expect(store.size()).toBe(0);
  });
});

describe("tetti contro l'abuso", () => {
  it("non supera il numero massimo di voci", () => {
    for (let i = 0; i < 10; i++) store.put(dati(10), `f${i}.xlsx`);
    expect(store.size()).toBeLessThanOrEqual(3);
  });

  it("sfratta la voce più vecchia quando è pieno", () => {
    const a = store.put(dati(10), "a.xlsx").key;
    adesso += 10;
    const b = store.put(dati(10), "b.xlsx").key;
    adesso += 10;
    const c = store.put(dati(10), "c.xlsx").key;
    adesso += 10;
    store.put(dati(10), "d.xlsx"); // supera maxEntries=3
    expect(store.get(a)).toBeNull();      // la più vecchia se ne va
    expect(store.get(b)).not.toBeNull();
    expect(store.get(c)).not.toBeNull();
  });

  it("non supera il tetto di byte complessivi", () => {
    for (let i = 0; i < 5; i++) store.put(dati(400), `f${i}.xlsx`);
    expect(store.totalBytes()).toBeLessThanOrEqual(1000);
  });

  it("rifiuta un file più grande del tetto invece di svuotare tutto", () => {
    store.put(dati(100), "piccolo.xlsx");
    expect(() => store.put(dati(2000), "enorme.xlsx")).toThrow();
    // Il file già depositato non deve essere stato sacrificato.
    expect(store.size()).toBe(1);
  });
});

describe("scadenza dichiarata", () => {
  it("torna il momento esatto in cui il link muore", () => {
    const { expiresAt } = store.put(dati(), "piano.xlsx");
    expect(expiresAt).toBe(adesso + 60_000);
  });
});

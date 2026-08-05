import { describe, expect, it } from "vitest";
import { deriveFlow } from "../src/engine/working-capital.js";

const costante = (v: number) => Array.from({ length: 13 }, () => v);
const somma = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("stato stazionario", () => {
  it("gli incassi settimanali eguagliano il fatturato settimanale", () => {
    // Il portafoglio crediti iniziale si smonta allo stesso ritmo con cui si
    // fanno vendite nuove: il DSO non muove il piano base.
    const f = deriveFlow({ perWeek: costante(10_000), days: 45 });
    expect(f).toEqual(costante(10_000));
  });

  it("il DSO non cambia nulla, qualunque valore abbia", () => {
    const a = deriveFlow({ perWeek: costante(10_000), days: 30 });
    const b = deriveFlow({ perWeek: costante(10_000), days: 90 });
    expect(a).toEqual(b);
  });

  it("NON azzera le prime settimane", () => {
    // L'errore ingenuo: "quelle vendite non sono ancora incassate" → zero
    // incassi per DSO/7 settimane → risulta in default chiunque.
    const f = deriveFlow({ perWeek: costante(10_000), days: 60 });
    expect(f.slice(0, 9).every((v) => v > 0)).toBe(true);
  });

  it("segue un fatturato che varia di settimana in settimana", () => {
    const ricavi = costante(0).map((_, i) => 1_000 * (i + 1));
    expect(deriveFlow({ perWeek: ricavi, days: 30 })).toEqual(ricavi);
  });
});

describe("saldo crediti iniziale, quando c'è", () => {
  it("un portafoglio in linea con lo stato stazionario non cambia niente", () => {
    // 10.000/settimana → 1.428,57/giorno; a 45 giorni ≈ 64.285,71 attesi.
    const atteso = (10_000 / 7) * 45;
    const f = deriveFlow({ perWeek: costante(10_000), days: 45, openingBalance: atteso });
    f.forEach((v) => expect(v).toBeCloseTo(10_000, 2));
  });

  it("un portafoglio più grosso del previsto porta incassi in più, all'inizio", () => {
    const atteso = (10_000 / 7) * 28;
    const f = deriveFlow({
      perWeek: costante(10_000), days: 28, openingBalance: atteso + 8_000,
    });
    // I 8.000 in eccesso entrano nelle prime 4 settimane (28 giorni).
    expect(somma(f.slice(0, 4))).toBeCloseTo(40_000 + 8_000, 2);
    // Dopo la transizione si torna al regime.
    f.slice(4).forEach((v) => expect(v).toBeCloseTo(10_000, 2));
  });

  it("un portafoglio più magro del previsto toglie incassi, all'inizio", () => {
    const atteso = (10_000 / 7) * 28;
    const f = deriveFlow({
      perWeek: costante(10_000), days: 28, openingBalance: atteso - 4_000,
    });
    expect(somma(f.slice(0, 4))).toBeCloseTo(40_000 - 4_000, 2);
  });

  it("non inventa incassi dal nulla: il totale del periodo torna", () => {
    const atteso = (10_000 / 7) * 35;
    const f = deriveFlow({
      perWeek: costante(10_000), days: 35, openingBalance: atteso + 12_000,
    });
    expect(somma(f)).toBeCloseTo(130_000 + 12_000, 2);
  });
});

describe("casi limite", () => {
  it("DSO a zero significa incasso immediato: stato stazionario comunque", () => {
    expect(deriveFlow({ perWeek: costante(5_000), days: 0 })).toEqual(costante(5_000));
  });

  it("una transizione più lunga del piano si spalma su tutte le 13 settimane", () => {
    const atteso = (10_000 / 7) * 180;
    const f = deriveFlow({
      perWeek: costante(10_000), days: 180, openingBalance: atteso + 13_000,
    });
    expect(somma(f)).toBeCloseTo(130_000 + 13_000, 2);
    f.forEach((v) => expect(v).toBeGreaterThan(10_000));
  });

  it("fatturato a zero e nessun credito: incassi a zero, non NaN", () => {
    const f = deriveFlow({ perWeek: costante(0), days: 45, openingBalance: 0 });
    expect(f).toEqual(costante(0));
  });

  it("rifiuta giorni negativi", () => {
    expect(() => deriveFlow({ perWeek: costante(1), days: -1 })).toThrow();
  });

  it("rifiuta una serie di lunghezza sbagliata", () => {
    expect(() => deriveFlow({ perWeek: [1, 2, 3], days: 30 })).toThrow();
  });

  it("rifiuta valori non finiti", () => {
    expect(() => deriveFlow({ perWeek: costante(Number.NaN), days: 30 })).toThrow();
  });
});

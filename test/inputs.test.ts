import { describe, expect, it } from "vitest";
import { MissingInputsError, normalizeInputs } from "../src/engine/inputs.js";

const minimo = {
  openingBalance: 10_000,
  receipts: 5_000,
  supplierPayments: 1_000,
  startDate: "2026-08-05",
};

describe("scalare o serie", () => {
  it("un numero solo vale per tutte e 13 le settimane", () => {
    const n = normalizeInputs(minimo);
    expect(n.receipts).toEqual(Array.from({ length: 13 }, () => 5_000));
  });

  it("una serie di 13 valori passa così com'è", () => {
    const serie = Array.from({ length: 13 }, (_, i) => i * 100);
    expect(normalizeInputs({ ...minimo, receipts: serie }).receipts).toEqual(serie);
  });

  it("rifiuta una serie di lunghezza diversa da 13, dicendo quale", () => {
    expect(() => normalizeInputs({ ...minimo, receipts: [1, 2, 3] }))
      .toThrow(/receipts/);
  });
});

describe("le voci facoltative valgono zero", () => {
  it("stipendi, rate e imposte assenti non fanno fallire il calcolo", () => {
    const n = normalizeInputs(minimo);
    expect(n.payroll.every((v) => v === 0)).toBe(true);
    expect(n.loanRepayments.every((v) => v === 0)).toBe(true);
    expect(n.taxes.every((v) => v === 0)).toBe(true);
  });
});

describe("fatturato + DSO al posto degli incassi", () => {
  it("accetta la via indiretta", () => {
    const n = normalizeInputs({
      openingBalance: 10_000,
      revenue: 7_000,
      dsoDays: 45,
      supplierPayments: 1_000,
      startDate: "2026-08-05",
    });
    // Stato stazionario: si incassa quel che si fattura.
    expect(n.receipts.every((v) => v === 7_000)).toBe(true);
  });

  it("usa il saldo crediti iniziale se c'è", () => {
    const atteso = (7_000 / 7) * 28;
    const n = normalizeInputs({
      openingBalance: 10_000, revenue: 7_000, dsoDays: 28,
      openingReceivables: atteso + 4_000,
      supplierPayments: 1_000, startDate: "2026-08-05",
    });
    const primeQuattro = n.receipts.slice(0, 4).reduce((a, b) => a + b, 0);
    expect(primeQuattro).toBeCloseTo(28_000 + 4_000, 2);
  });

  it("gli incassi diretti hanno la precedenza sul fatturato", () => {
    const n = normalizeInputs({ ...minimo, revenue: 99_999, dsoDays: 30 });
    expect(n.receipts.every((v) => v === 5_000)).toBe(true);
  });

  it("il fatturato senza DSO non basta", () => {
    expect(() => normalizeInputs({
      openingBalance: 1, revenue: 7_000, supplierPayments: 1, startDate: "2026-08-05",
    })).toThrow(MissingInputsError);
  });

  it("vale lo stesso per acquisti + DPO", () => {
    const n = normalizeInputs({
      openingBalance: 10_000, receipts: 5_000,
      purchases: 3_000, dpoDays: 60, startDate: "2026-08-05",
    });
    expect(n.supplierPayments.every((v) => v === 3_000)).toBe(true);
  });
});

describe("cosa manca, detto con chiarezza", () => {
  it("elenca i dati mancanti invece di fallire e basta", () => {
    try {
      normalizeInputs({ startDate: "2026-08-05" } as never);
      expect.unreachable("doveva sollevare");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingInputsError);
      const mancanti = (e as MissingInputsError).missing;
      expect(mancanti).toContain("openingBalance");
      expect(mancanti).toContain("receipts");
      expect(mancanti).toContain("supplierPayments");
    }
  });

  it("non elenca quello che è già stato dato", () => {
    try {
      normalizeInputs({ openingBalance: 100, receipts: 10 } as never);
      expect.unreachable("doveva sollevare");
    } catch (e) {
      const mancanti = (e as MissingInputsError).missing;
      expect(mancanti).not.toContain("openingBalance");
      expect(mancanti).not.toContain("receipts");
      expect(mancanti).toEqual(["supplierPayments"]);
    }
  });

  it("un saldo iniziale di zero è un dato valido, non un dato mancante", () => {
    // Zero è un saldo legittimo, e confonderlo con "non me l'hai detto"
    // farebbe ripetere la domanda a chi ha già risposto.
    const n = normalizeInputs({ ...minimo, openingBalance: 0 });
    expect(n.openingBalance).toBe(0);
  });
});

describe("data di partenza", () => {
  it("accetta una data ISO", () => {
    const n = normalizeInputs(minimo);
    expect(n.startDate.toISOString().slice(0, 10)).toBe("2026-08-05");
  });

  it("senza data parte da oggi invece di fallire", () => {
    const n = normalizeInputs({ ...minimo, startDate: undefined });
    expect(Number.isNaN(n.startDate.getTime())).toBe(false);
  });

  it("rifiuta una data che non esiste", () => {
    expect(() => normalizeInputs({ ...minimo, startDate: "2026-02-31" })).toThrow();
    expect(() => normalizeInputs({ ...minimo, startDate: "domani" })).toThrow();
  });
});

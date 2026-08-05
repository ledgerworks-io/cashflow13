import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/engine/plan.js";
import type { CashFlowInputs } from "../src/engine/plan.js";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Tredici settimane tutte uguali, per non far dipendere i test dai dati. */
const costante = (v: number) => Array.from({ length: 13 }, () => v);

const base = (over: Partial<CashFlowInputs> = {}): CashFlowInputs => ({
  startDate: utc("2026-08-05"),
  openingBalance: 45_000,
  receipts: costante(28_000),
  supplierPayments: costante(19_000),
  payroll: costante(14_500),
  loanRepayments: costante(3_200),
  taxes: costante(4_100),
  ...over,
});

describe("griglia", () => {
  it("la settimana 1 apre col saldo iniziale", () => {
    const p = buildPlan(base());
    expect(p.weeks[0]!.opening).toBe(45_000);
  });

  it("ogni settimana apre con la chiusura della precedente", () => {
    const p = buildPlan(base());
    for (let i = 1; i < 13; i++) {
      expect(p.weeks[i]!.opening).toBe(p.weeks[i - 1]!.closing);
    }
  });

  it("il movimento netto è incassi meno tutte le uscite", () => {
    const p = buildPlan(base());
    // 28.000 − 19.000 − 14.500 − 3.200 − 4.100
    expect(p.weeks[0]!.netMovement).toBe(-12_800);
  });

  it("la chiusura è apertura più movimento", () => {
    const p = buildPlan(base());
    for (const w of p.weeks) {
      expect(w.closing).toBe(w.opening + w.netMovement);
    }
  });

  it("produce 13 righe numerate da 1 a 13", () => {
    const p = buildPlan(base());
    expect(p.weeks.map((w) => w.week)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    );
  });
});

describe("il punto di rottura", () => {
  it("trova la prima settimana sotto zero e di quanto", () => {
    const p = buildPlan(base());
    // 45.000 − 12.800×4 = −6.200
    expect(p.firstNegativeWeek).toBe(4);
    expect(p.shortfallAtFirstNegative).toBe(-6_200);
  });

  it("saldo esattamente zero NON è sotto zero", () => {
    // Il caso limite che decide se lo strumento dice il vero o allarma a vuoto.
    const p = buildPlan(base({ openingBalance: 12_800, receipts: costante(28_000) }));
    expect(p.weeks[0]!.closing).toBe(0);
    expect(p.firstNegativeWeek).toBe(2);
  });

  it("se non va mai sotto zero lo dice, invece di inventare una settimana", () => {
    const p = buildPlan(base({ receipts: costante(41_000) }));
    expect(p.firstNegativeWeek).toBeNull();
    expect(p.shortfallAtFirstNegative).toBeNull();
    expect(p.peakFundingNeed).toBe(0);
  });

  it("riconosce una rottura già alla settimana 1", () => {
    const p = buildPlan(base({ openingBalance: 1_000 }));
    expect(p.firstNegativeWeek).toBe(1);
    expect(p.shortfallAtFirstNegative).toBe(-11_800);
  });
});

describe("fabbisogno massimo", () => {
  it("NON coincide con lo scoperto della prima settimana negativa", () => {
    // Scende sotto zero, risale, poi sprofonda: il picco è più avanti.
    // Confondere i due numeri è l'errore classico di questi strumenti.
    const receipts = [...costante(13)];
    receipts[3] = 0;        // settimana 4: niente incassi → tonfo
    receipts[4] = 200_000;  // settimana 5: rientro
    const p = buildPlan(base({
      openingBalance: 10_000,
      receipts: receipts.map((_, i) =>
        i === 3 ? 0 : i === 4 ? 200_000 : 28_000),
    }));
    expect(p.firstNegativeWeek).toBe(1);
    // Il picco è il punto più basso di TUTTO il periodo, non il primo tuffo.
    expect(p.peakFundingNeed).toBe(-p.lowestClosingBalance);
    expect(p.peakFundingNeed).toBeGreaterThan(
      Math.abs(p.shortfallAtFirstNegative!),
    );
  });

  it("è zero, non negativo, quando la cassa resta sempre positiva", () => {
    const p = buildPlan(base({ openingBalance: 500_000 }));
    expect(p.peakFundingNeed).toBe(0);
    expect(p.lowestClosingBalance).toBeGreaterThan(0);
  });

  it("è un numero positivo: è quanto serve, non quanto manca", () => {
    const p = buildPlan(base());
    expect(p.peakFundingNeed).toBeGreaterThan(0);
    expect(p.peakFundingNeed).toBe(121_400);
  });
});

describe("aritmetica del denaro", () => {
  it("non lascia code di virgola dalla somma di decimali", () => {
    // 0.1 + 0.2 !== 0.3 in virgola mobile. Su 13 settimane e sei flussi
    // l'errore si accumula, e un saldo che dovrebbe essere zero puo' uscire
    // a −0,0000000001: lo strumento direbbe "sei sotto zero" mentre non lo sei.
    const p = buildPlan(base({
      openingBalance: 0.3,
      receipts: costante(0.1),
      supplierPayments: costante(0.1),
      payroll: costante(0),
      loanRepayments: costante(0),
      taxes: costante(0),
    }));
    for (const w of p.weeks) expect(w.closing).toBe(0.3);
    expect(p.firstNegativeWeek).toBeNull();
  });

  it("arrotonda al centesimo", () => {
    const p = buildPlan(base({
      openingBalance: 100,
      receipts: costante(0.005),
      supplierPayments: costante(0),
      payroll: costante(0),
      loanRepayments: costante(0),
      taxes: costante(0),
    }));
    expect(p.weeks[0]!.closing).toBe(100.01);
  });
});

describe("controlli sugli ingressi", () => {
  it("rifiuta una serie che non ha 13 valori", () => {
    expect(() => buildPlan(base({ receipts: costante(1).slice(0, 12) }))).toThrow();
  });

  it("rifiuta valori non finiti invece di propagare NaN nella griglia", () => {
    expect(() => buildPlan(base({ openingBalance: Number.NaN }))).toThrow();
    expect(() => buildPlan(base({ receipts: costante(Number.POSITIVE_INFINITY) }))).toThrow();
  });

  it("accetta valori negativi in una serie: un rimborso è un incasso negativo", () => {
    const p = buildPlan(base({ receipts: costante(-1_000) }));
    expect(p.weeks[0]!.receipts).toBe(-1_000);
  });
});

describe("intestazione", () => {
  it("riporta la convenzione usata, così chi riceve il file sa cosa guarda", () => {
    const p = buildPlan(base());
    expect(p.weekEndsOn).toBe("Friday");
    expect(p.weeks[0]!.weekEnding.toISOString().slice(0, 10)).toBe("2026-08-07");
  });
});

import { describe, expect, it } from "vitest";
import { auditDataset, type FilterRule } from "../src/audit/report.js";

/**
 * Il revisore risponde a una domanda sola: di quello che hai pagato, quanto era
 * davvero quello che avevi chiesto? I casi qui sotto vengono dalle lamentele
 * vere raccolte sul negozio Apify, non da ipotesi.
 */

const righe = [
  { id: "a", email: "mario@example.com", stars: 10, date: "2026-08-01" },
  { id: "b", email: "lucia@example.com", stars: 3, date: "2026-08-02" },
  { id: "a", email: "mario@example.com", stars: 10, date: "2026-08-01" }, // duplicato
  { id: "c", email: "", stars: 40, date: "2025-11-15" },
];

describe("duplicati", () => {
  it("conta una volta sola le righe con la stessa chiave", () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"] });
    expect(r.total).toBe(4);
    expect(r.unique).toBe(3);
    expect(r.duplicates).toBe(1);
  });

  it("dice QUALI chiavi si ripetono, non solo quante", () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"] });
    expect(r.duplicateGroups).toEqual([{ key: "a", count: 2 }]);
  });

  it("senza chiave dichiarata confronta la riga intera", () => {
    const r = auditDataset(righe, {});
    expect(r.unique).toBe(3);
  });

  it("una chiave composta distingue righe che una chiave sola confonderebbe", () => {
    const dati = [
      { nome: "Rossi", citta: "Milano" },
      { nome: "Rossi", citta: "Roma" },
    ];
    expect(auditDataset(dati, { dedupeKeys: ["nome"] }).unique).toBe(1);
    expect(auditDataset(dati, { dedupeKeys: ["nome", "citta"] }).unique).toBe(2);
  });
});

describe("filtri chiesti e non rispettati", () => {
  it("conta le righe sotto la soglia minima richiesta", () => {
    const filtri: FilterRule[] = [{ field: "stars", op: "min", value: 5 }];
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri });
    expect(r.violations[0]?.count).toBe(1); // lucia, 3 stelle
  });

  it("conta le righe fuori dalla finestra temporale richiesta", () => {
    const filtri: FilterRule[] = [{ field: "date", op: "after", value: "2026-07-01" }];
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri });
    expect(r.violations[0]?.count).toBe(1); // la riga di novembre
  });

  it("un campo obbligatorio vuoto è una violazione, non un dettaglio", () => {
    const filtri: FilterRule[] = [{ field: "email", op: "nonEmpty" }];
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri });
    expect(r.violations[0]?.count).toBe(1); // email vuota
  });

  it("un campo assente conta come violazione: non c'è vale quanto è sbagliato", () => {
    const filtri: FilterRule[] = [{ field: "telefono", op: "nonEmpty" }];
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri });
    expect(r.violations[0]?.count).toBe(3); // tutte le righe uniche
  });

  it("legge anche i campi annidati", () => {
    const dati = [{ autore: { nome: "Anna" } }, { autore: { nome: "" } }];
    const filtri: FilterRule[] = [{ field: "autore.nome", op: "nonEmpty" }];
    expect(auditDataset(dati, { filters: filtri }).violations[0]?.count).toBe(1);
  });
});

describe("il conto finale", () => {
  it("è buona solo la riga unica che rispetta tutti i filtri", () => {
    const filtri: FilterRule[] = [
      { field: "stars", op: "min", value: 5 },
      { field: "email", op: "nonEmpty" },
    ];
    const r = auditDataset(righe, { dedupeKeys: ["id"], filters: filtri });
    expect(r.good).toBe(1); // solo mario
  });

  it("il costo per record buono è quello vero, non quello dichiarato", () => {
    const filtri: FilterRule[] = [{ field: "email", op: "nonEmpty" }];
    const r = auditDataset(righe, {
      dedupeKeys: ["id"],
      filters: filtri,
      amountPaidUsd: 10,
    });
    expect(r.good).toBe(2);
    expect(r.costPerGoodRecordUsd).toBeCloseTo(5);
  });

  it("il caso della recensione: 2.000 pagati, 748 unici", () => {
    const dati = Array.from({ length: 2_000 }, (_, i) => ({ id: `j${i % 748}` }));
    const r = auditDataset(dati, { dedupeKeys: ["id"], amountPaidUsd: 10 });
    expect(r.unique).toBe(748);
    expect(r.costPerGoodRecordUsd).toBeCloseTo(0.013369, 5);
  });

  it("senza importo dichiarato non inventa un costo", () => {
    expect(auditDataset(righe, {}).costPerGoodRecordUsd).toBeNull();
  });

  it("zero righe buone non diventa una divisione per zero", () => {
    const filtri: FilterRule[] = [{ field: "email", op: "matches", value: "^nessuno$" }];
    const r = auditDataset(righe, { filters: filtri, amountPaidUsd: 10 });
    expect(r.good).toBe(0);
    expect(r.costPerGoodRecordUsd).toBeNull();
  });

  it("un dataset vuoto non fa esplodere niente", () => {
    const r = auditDataset([], { dedupeKeys: ["id"], amountPaidUsd: 5 });
    expect(r.total).toBe(0);
    expect(r.good).toBe(0);
    expect(r.costPerGoodRecordUsd).toBeNull();
  });
});

describe("campi vuoti, come avviso e non come giudizio", () => {
  it("segnala quante volte ogni campo è arrivato vuoto", () => {
    const r = auditDataset(righe, { dedupeKeys: ["id"] });
    const email = r.emptyFields.find((e) => e.field === "email");
    expect(email?.count).toBe(1);
  });
});

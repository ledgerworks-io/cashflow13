import { describe, expect, it } from "vitest";
import { WEEKDAYS, weekEndings } from "../src/engine/calendar.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("calendario delle 13 settimane", () => {
  it("chiude di venerdì per impostazione predefinita", () => {
    // 2026-08-05 è un mercoledì → il primo venerdì è il 7.
    const w = weekEndings(utc("2026-08-05"));
    expect(iso(w[0]!)).toBe("2026-08-07");
  });

  it("se la data di partenza È già il giorno di chiusura, quella è la settimana 1", () => {
    // Il caso limite che fa perdere una settimana a chi non ci pensa.
    const w = weekEndings(utc("2026-08-07")); // è venerdì
    expect(iso(w[0]!)).toBe("2026-08-07");
  });

  it("il giorno dopo la chiusura salta alla settimana seguente", () => {
    const w = weekEndings(utc("2026-08-08")); // sabato
    expect(iso(w[0]!)).toBe("2026-08-14");
  });

  it("restituisce esattamente 13 settimane, a 7 giorni esatti l'una dall'altra", () => {
    const w = weekEndings(utc("2026-08-05"));
    expect(w).toHaveLength(13);
    for (let i = 1; i < w.length; i++) {
      const giorni = (w[i]!.getTime() - w[i - 1]!.getTime()) / 86_400_000;
      expect(giorni).toBe(7);
    }
  });

  it("l'ultima settimana cade 12 settimane dopo la prima", () => {
    const w = weekEndings(utc("2026-08-05"));
    expect(iso(w[12]!)).toBe("2026-10-30");
  });

  it("accetta un giorno di chiusura diverso", () => {
    // Domenica = 0, lunedì = 1 … venerdì = 5.
    expect(iso(weekEndings(utc("2026-08-05"), 0)[0]!)).toBe("2026-08-09"); // domenica
    expect(iso(weekEndings(utc("2026-08-05"), 1)[0]!)).toBe("2026-08-10"); // lunedì
    expect(iso(weekEndings(utc("2026-08-05"), 3)[0]!)).toBe("2026-08-05"); // mercoledì, oggi
  });

  it("attraversa il cambio dell'ora legale senza slittare", () => {
    // In Europa l'ora legale finisce il 2026-10-25. Lavorando in UTC le
    // settimane restano di 7 giorni esatti: se si usasse l'ora locale, una
    // settimana diventerebbe di 7 giorni e 1 ora e le date scivolerebbero.
    const w = weekEndings(utc("2026-10-01"));
    for (let i = 1; i < w.length; i++) {
      expect((w[i]!.getTime() - w[i - 1]!.getTime()) / 86_400_000).toBe(7);
    }
    expect(iso(w[0]!)).toBe("2026-10-02");
  });

  it("attraversa il cambio d'anno", () => {
    const w = weekEndings(utc("2026-12-28"));
    expect(iso(w[0]!)).toBe("2027-01-01");
    expect(iso(w[12]!)).toBe("2027-03-26");
  });

  it("rifiuta un giorno di chiusura fuori intervallo invece di produrre date assurde", () => {
    expect(() => weekEndings(utc("2026-08-05"), 7)).toThrow();
    expect(() => weekEndings(utc("2026-08-05"), -1)).toThrow();
  });

  it("rifiuta una data non valida", () => {
    expect(() => weekEndings(new Date("non-una-data"))).toThrow();
  });

  it("espone i nomi dei giorni allineati agli indici", () => {
    expect(WEEKDAYS[5]).toBe("Friday");
    expect(WEEKDAYS).toHaveLength(7);
  });
});

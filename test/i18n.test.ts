import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  STRINGS,
  SUPPORTED_LOCALES,
  resolveLocale,
  t,
} from "../src/i18n/index.js";
import type { StringKey } from "../src/i18n/strings.js";

const KEYS = Object.keys(STRINGS) as StringKey[];

describe("tabella di localizzazione", () => {
  it("non è vuota", () => {
    expect(KEYS.length).toBeGreaterThan(0);
  });

  it("ogni chiave esiste in ogni lingua supportata", () => {
    const buchi: string[] = [];
    for (const key of KEYS) {
      for (const locale of SUPPORTED_LOCALES) {
        const value = STRINGS[key][locale];
        if (typeof value !== "string" || value.trim() === "") {
          buchi.push(`${key} → ${locale}`);
        }
      }
    }
    expect(buchi).toEqual([]);
  });

  it("nessuna traduzione è una copia pigra dell'inglese", () => {
    // Se it === en la stringa non è stata tradotta, è stata incollata.
    const sospette = KEYS.filter((k) => STRINGS[k].it === STRINGS[k].en);
    expect(sospette).toEqual([]);
  });
});

describe("resolveLocale", () => {
  it("accetta un codice secco", () => {
    expect(resolveLocale("it")).toBe("it");
    expect(resolveLocale("en")).toBe("en");
  });

  it("accetta un tag regionale, con trattino o underscore", () => {
    expect(resolveLocale("it-IT")).toBe("it");
    expect(resolveLocale("it_CH")).toBe("it");
    expect(resolveLocale("en-GB")).toBe("en");
  });

  it("ignora le maiuscole", () => {
    expect(resolveLocale("IT")).toBe("it");
    expect(resolveLocale("It-It")).toBe("it");
  });

  it("legge un header Accept-Language e rispetta i pesi q", () => {
    expect(resolveLocale("it-IT,it;q=0.9,en;q=0.8")).toBe("it");
    // q piu' alto vince anche se non e' il primo della lista.
    expect(resolveLocale("de;q=0.5,it;q=0.9")).toBe("it");
    // Una lingua non supportata in testa non deve nascondere quella supportata.
    expect(resolveLocale("fr-FR,de;q=0.8,it;q=0.7")).toBe("it");
  });

  it("scarta i tag con q=0", () => {
    expect(resolveLocale("it;q=0,en;q=0.5")).toBe("en");
  });

  it("torna all'inglese su input mancante o sconosciuto", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("klingon")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("de-DE")).toBe(DEFAULT_LOCALE);
  });
});

describe("t", () => {
  it("traduce nella lingua richiesta", () => {
    expect(t("tool.health.ok", "en")).toBe("Server is running.");
    expect(t("tool.health.ok", "it")).toBe("Il server è in funzione.");
  });

  it("usa l'inglese quando la lingua non è indicata", () => {
    expect(t("tool.health.ok")).toBe(STRINGS["tool.health.ok"].en);
  });

  it("restituisce sempre una stringa non vuota per ogni chiave e lingua", () => {
    for (const key of KEYS) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(t(key, locale).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

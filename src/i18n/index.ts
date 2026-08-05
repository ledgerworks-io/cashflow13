import {
  DEFAULT_LOCALE,
  STRINGS,
  SUPPORTED_LOCALES,
  type Locale,
  type StringKey,
} from "./strings.js";

export {
  DEFAULT_LOCALE,
  STRINGS,
  SUPPORTED_LOCALES,
  type Locale,
  type StringKey,
};

/**
 * Riconosce una lingua a partire da quello che arriva dal client: un codice
 * secco ("it"), un tag regionale ("it-IT", "en_GB") o un header Accept-Language
 * ("it-IT,it;q=0.9,en;q=0.8"). Quello che non si riconosce diventa inglese:
 * uno strumento finanziario non deve mai fallire per colpa di un'etichetta.
 */
export function resolveLocale(input: string | undefined | null): Locale {
  if (!input) return DEFAULT_LOCALE;

  for (const candidate of parseAcceptLanguage(input)) {
    const base = candidate.split(/[-_]/)[0]?.toLowerCase();
    const match = SUPPORTED_LOCALES.find((l) => l === base);
    if (match) return match;
  }

  return DEFAULT_LOCALE;
}

/** Restituisce i tag in ordine di preferenza decrescente (q piu' alto prima). */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p))
        .find((m) => m !== null);
      return { tag: (tag ?? "").trim(), q: q ? Number(q[1]) : 1 };
    })
    .filter((e) => e.tag.length > 0 && !Number.isNaN(e.q) && e.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((e) => e.tag);
}

/**
 * Traduce una chiave. Se manca la traduzione nella lingua scelta si ricade
 * sull'inglese, che la tabella garantisce sempre presente.
 */
export function t(key: StringKey, locale: Locale = DEFAULT_LOCALE): string {
  const entry = STRINGS[key];
  return entry[locale] || entry[DEFAULT_LOCALE];
}

/**
 * Traduce con il numero: usa la chiave `<key>_one` quando n vale 1, e
 * sostituisce {n} altrove. Serve per non scrivere "1 settimana/e".
 *
 * Inglese e italiano condividono la stessa regola (uno contro tutto il resto).
 * Una lingua con piu' forme plurali richiedera' un vero selettore: quando
 * succedera' cambia questa funzione, non i punti che la chiamano.
 */
export function tn(key: StringKey, n: number, locale: Locale = DEFAULT_LOCALE): string {
  if (Math.abs(n) === 1) {
    const singolare = `${key}_one` as StringKey;
    if (singolare in STRINGS) return t(singolare, locale);
  }
  return t(key, locale).replace("{n}", String(n));
}

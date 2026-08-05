/**
 * Tabella di localizzazione.
 *
 * Regola di progetto: nessuna etichetta rivolta all'utente viene scritta a mano
 * nel codice. Tutto passa di qui. L'inglese e' la lingua del prodotto, l'italiano
 * esiste dal primo commit perche' aggiungerlo dopo significa riscrivere.
 *
 * Le chiavi del motore (griglia 13 settimane, intestazioni Excel, leve) si
 * aggiungono a questa stessa tabella: la forma non cambia.
 */

export const SUPPORTED_LOCALES = ["en", "it"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** L'inglese e' il riferimento: ogni chiave deve esistere qui. */
export const DEFAULT_LOCALE: Locale = "en";

/** Una voce = una chiave tradotta in tutte le lingue supportate. */
export type Translations = Record<Locale, string>;

export const STRINGS = {
  // --- Identita' del servizio -------------------------------------------
  "server.name": {
    en: "13-Week Cash Flow",
    it: "Piano di cassa a 13 settimane",
  },
  "server.description": {
    en: "Builds a 13-week cash flow plan and a live Excel workbook with real formulas.",
    it: "Costruisce un piano di cassa a 13 settimane e una cartella Excel viva con formule vere.",
  },

  // --- Strumento di servizio --------------------------------------------
  "tool.health.description": {
    en: "Report server status, version and supported languages.",
    it: "Riporta stato del server, versione e lingue supportate.",
  },
  "tool.health.ok": {
    en: "Server is running.",
    it: "Il server è in funzione.",
  },

  // --- Consegna della cartella Excel -------------------------------------
  "tool.workbook.description": {
    en: "Build the 13-week cash flow workbook and return a temporary download link.",
    it: "Costruisce la cartella Excel del piano a 13 settimane e restituisce un link temporaneo per scaricarla.",
  },
  "tool.workbook.ready": {
    en: "Your workbook is ready. The link below is temporary — download it now and save it.",
    it: "La cartella è pronta. Il link qui sotto è temporaneo: scaricala adesso e salvala.",
  },
  "tool.workbook.hint": {
    en: "Open it in Excel: the yellow cells at the top drive every formula below.",
    it: "Aprila in Excel: le celle gialle in testa pilotano tutte le formule sottostanti.",
  },

  // --- Errori ------------------------------------------------------------
  "error.link_expired": {
    en: "This download link has expired. Ask for the plan again to get a fresh one.",
    it: "Questo link è scaduto. Richiedi di nuovo il piano per averne uno valido.",
  },
  "error.unsupported_locale": {
    en: "Unsupported language; falling back to English.",
    it: "Lingua non supportata; si torna all'inglese.",
  },
  "error.internal": {
    en: "Internal error. No data was stored.",
    it: "Errore interno. Nessun dato è stato archiviato.",
  },
} as const satisfies Record<string, Translations>;

export type StringKey = keyof typeof STRINGS;

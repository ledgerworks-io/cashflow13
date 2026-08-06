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
  // Questa e' la frase che un modello legge per decidere se chiamare lo
  // strumento. Vale piu' di qualunque scheda di catalogo: deve dire cosa fa,
  // con che dati, e QUANDO usarlo — nel vocabolario di chi ha il problema.
  "tool.workbook.description": {
    en:
      "Build a 13-week cash flow forecast and return a live Excel workbook. " +
      "Use this when someone asks when they will run out of cash, how long their " +
      "runway is, how much funding they need to bridge a gap, or wants a short-term " +
      "liquidity or treasury forecast. Takes opening cash balance, expected receipts " +
      "(or revenue and DSO), supplier payments (or purchases and DPO), payroll, loan " +
      "instalments and taxes due. Returns the week-by-week grid, the first week cash " +
      "goes negative, the peak funding need, and levers such as collecting earlier or " +
      "paying later.",
    it:
      "Costruisce un piano di cassa a 13 settimane e restituisce una cartella Excel viva. " +
      "Da usare quando qualcuno chiede quando finiranno i soldi, quanta autonomia di cassa " +
      "ha, di quanto fabbisogno ha bisogno per coprire un buco, o vuole una previsione di " +
      "liquidità a breve. Prende saldo iniziale, incassi attesi (o fatturato e DSO), " +
      "pagamenti fornitori (o acquisti e DPO), stipendi, rate e imposte in scadenza. " +
      "Restituisce la griglia settimanale, la settimana in cui la cassa va sotto zero, " +
      "il fabbisogno massimo e le leve.",
  },
  "tool.workbook.ready": {
    en: "Your workbook is ready. The link below is temporary — download it now and save it.",
    it: "La cartella è pronta. Il link qui sotto è temporaneo: scaricala adesso e salvala.",
  },
  "tool.workbook.saved": {
    en: "Saved to your computer. It never left it — the plan was built here.",
    it: "Salvata sul tuo computer. Non è mai uscita da lì: il piano è stato costruito in locale.",
  },
  "tool.workbook.hint": {
    en: "Open it in Excel: every yellow cell is editable, and the whole plan recalculates as you change them.",
    it: "Aprila in Excel: ogni cella gialla è modificabile, e il piano si ricalcola man mano che le cambi.",
  },

  // --- Leve ---------------------------------------------------------------
  "lever.heading": {
    en: "What would move the date",
    it: "Cosa sposterebbe la data",
  },
  // Le chiavi in coppia `_one` reggono il singolare: "1 settimana", non
  // "1 settimana/e". La barra e' un modo per non decidere, e si vede.
  "lever.collect_earlier": {
    en: "Collect {n} days earlier",
    it: "Incassare {n} giorni prima",
  },
  "lever.collect_earlier_one": {
    en: "Collect 1 day earlier",
    it: "Incassare 1 giorno prima",
  },
  "lever.pay_later": {
    en: "Pay suppliers {n} days later",
    it: "Pagare i fornitori {n} giorni dopo",
  },
  "lever.pay_later_one": {
    en: "Pay suppliers 1 day later",
    it: "Pagare i fornitori 1 giorno dopo",
  },
  "lever.shift_payroll": {
    en: "Move payroll {n} weeks later",
    it: "Spostare gli stipendi di {n} settimane",
  },
  "lever.shift_payroll_one": {
    en: "Move payroll one week later",
    it: "Spostare gli stipendi di una settimana",
  },
  "lever.avoids": {
    en: "cash never goes negative",
    it: "la cassa non va mai sotto zero",
  },
  "lever.gains_weeks": {
    en: "buys {n} more weeks",
    it: "guadagna {n} settimane",
  },
  "lever.gains_weeks_one": {
    en: "buys one more week",
    it: "guadagna una settimana",
  },
  "lever.peak_need": {
    en: "peak need",
    it: "fabbisogno massimo",
  },
  "lever.no_change": {
    en: "does not move the date",
    it: "non sposta la data",
  },
  "lever.beyond_horizon": {
    en: "note: one payment falls after week 13 — deferred, not saved",
    it: "attenzione: un pagamento cade dopo la settimana 13 — rinviato, non risparmiato",
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

  // --- Revisore delle esecuzioni ----------------------------------------
  "audit.title": {
    en: "Run receipt — what you actually got",
    it: "Ricevuta dell'esecuzione — cosa hai ricevuto davvero",
  },
  "audit.input_note": {
    en: "The yellow cell is an input — change what you paid and every figure recalculates.",
    it: "La cella gialla è un input: cambia quanto hai pagato e tutti i numeri si ricalcolano.",
  },
  "audit.paid": { en: "Amount paid (USD)", it: "Importo pagato (USD)" },
  "audit.delivered": { en: "Records delivered", it: "Record consegnati" },
  "audit.unique": { en: "Distinct records", it: "Record distinti" },
  "audit.duplicates": { en: "Duplicates you paid for", it: "Duplicati che hai pagato" },
  "audit.good": {
    en: "Records matching what you asked for",
    it: "Record conformi a quello che avevi chiesto",
  },
  "audit.cost_delivered": {
    en: "Cost per delivered record",
    it: "Costo per record consegnato",
  },
  "audit.cost_good": { en: "Cost per usable record", it: "Costo per record utile" },
  "audit.ratio": {
    en: "Times more than the headline price",
    it: "Volte il prezzo apparente",
  },
  "audit.sheet.receipt": { en: "Receipt", it: "Ricevuta" },
  "audit.sheet.duplicates": { en: "Duplicates", it: "Duplicati" },
  "audit.sheet.violations": { en: "Unmet criteria", it: "Criteri non rispettati" },
  "audit.sheet.empty": { en: "Empty fields", it: "Campi vuoti" },
  "audit.col.key": { en: "Key", it: "Chiave" },
  "audit.col.count": { en: "Times", it: "Volte" },
  "audit.col.rule": { en: "Criterion you asked for", it: "Criterio che avevi chiesto" },
  "audit.col.failing": { en: "Records failing it", it: "Record che non lo rispettano" },
  "audit.col.field": { en: "Field", it: "Campo" },
  "audit.none": { en: "Nothing to report here.", it: "Niente da segnalare qui." },
  "audit.no_price": {
    en: "No amount entered, so no cost per record can be computed.",
    it: "Nessun importo indicato: il costo per record non si può calcolare.",
  },
  "audit.scope": {
    en: "This tool reads only the dataset you point it at. It has no access to your account.",
    it: "Questo strumento legge solo il dataset che gli indichi. Non ha accesso al tuo account.",
  },

  // --- Aggiudicatore: verdetto per record --------------------------------
  // Il motore emette codici, mai frasi. Le frasi stanno qui, dal primo commit.
  "verdict.good": { en: "Usable", it: "Utilizzabile" },
  "verdict.rejected": { en: "Rejected", it: "Scartato" },
  "verdict.duplicate": { en: "Duplicate", it: "Doppione" },
  "verdict.undecidable": { en: "Not adjudicated", it: "Non aggiudicato" },

  "reason.duplicate": {
    en: "Already delivered earlier in the same file.",
    it: "Già consegnato prima nello stesso file.",
  },
  "reason.empty": {
    en: "The field you asked for arrived empty.",
    it: "Il campo che avevi chiesto è arrivato vuoto.",
  },
  "reason.filter": {
    en: "Does not meet a criterion you declared.",
    it: "Non rispetta un criterio che avevi dichiarato.",
  },
  "reason.email": {
    en: "The address cannot receive mail.",
    it: "L'indirizzo non può ricevere posta.",
  },

  "warning.email": {
    en: "Worth knowing, but it did not decide the verdict.",
    it: "Vale la pena saperlo, ma non ha deciso il verdetto.",
  },

  // --- Aggiudicatore: la garanzia ----------------------------------------
  "adjudicate.billable": { en: "Charged", it: "Addebitati" },
  "adjudicate.not_billable": { en: "Not charged", it: "Non addebitati" },
  "adjudicate.guarantee": {
    en: "You are charged only for records we could adjudicate. What we cannot prove, you do not pay for.",
    it: "Paghi solo i record che siamo riusciti ad aggiudicare. Quello che non sappiamo dimostrare non te lo addebitiamo.",
  },
  "adjudicate.undecidable_note": {
    en: "Whether this mailbox exists cannot be verified, so this record is free.",
    it: "Se questa casella esista non è verificabile: questo record è gratuito.",
  },

  // --- Aggiudicatore: la ricevuta ----------------------------------------
  "adj.sheet.verdicts": { en: "Verdicts", it: "Verdetti" },
  "adj.col.row": { en: "Row in your file", it: "Riga nel tuo file" },
  "adj.col.verdict": { en: "Verdict", it: "Verdetto" },
  "adj.col.billing": { en: "Billing", it: "Addebito" },
  "adj.col.why": { en: "Why", it: "Perché" },
  "adj.col.note": { en: "Worth knowing", it: "Da sapere" },
  // Non "Yes"/"No": in italiano "No" è identico all'inglese, e un'etichetta
  // che si spiega da sola sta meglio in una ricevuta.
  "adj.charged.yes": { en: "Charged", it: "Addebitato" },
  "adj.charged.no": { en: "Not charged", it: "Non addebitato" },
  "adj.billing.header": {
    en: "What this audit costs you",
    it: "Quanto ti costa questa revisione",
  },
  "adj.billing.free": {
    en: "Free allowance, every run",
    it: "Quota gratuita, a ogni esecuzione",
  },
  "adj.billing.charged_count": { en: "Records charged", it: "Record addebitati" },
  "adj.billing.price": {
    en: "Price per adjudicated record",
    it: "Prezzo per record aggiudicato",
  },
  "adj.billing.cap": {
    en: "Cap: half of what you paid for the data",
    it: "Tetto: metà di quanto hai speso per i dati",
  },
  "adj.billing.total": { en: "Total charged", it: "Totale addebitato" },
  "adj.rejected": { en: "Records rejected", it: "Record scartati" },
  "adj.undecidable": {
    en: "Records we could not adjudicate",
    it: "Record che non siamo riusciti ad aggiudicare",
  },
} as const satisfies Record<string, Translations>;

export type StringKey = keyof typeof STRINGS;

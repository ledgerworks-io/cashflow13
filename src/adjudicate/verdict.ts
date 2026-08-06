/**
 * L'aggiudicatore: un verdetto per ogni riga, con la ragione.
 *
 * Il revisore (`src/audit/report.ts`) dice in aggregato quanto di quello che hai
 * pagato era quello che avevi chiesto. Qui si scende di un livello, perché il
 * cliente deve poter tornare nel suo file e vedere QUALE record è stato
 * scartato e perché.
 *
 * La regola che è il prodotto: **si fattura solo quello che si riesce ad
 * aggiudicare.** Se non sappiamo decidere, non si addebita.
 *
 * Il punto sottile, e vale la pena scriverlo perché non è ovvio: un verdetto di
 * scarto è sempre CERTO, quindi sempre fatturabile — anche quando una colonna è
 * rimasta indecidibile. Se una riga ha già violato un criterio dimostrabile, il
 * risultato finale non cambia più, qualunque cosa dicesse la colonna mancante.
 * L'incertezza morde solo nell'altro verso: una riga che passa tutto il
 * decidibile ma ha una colonna indecidibile NON è dimostrata buona, e allora
 * non si fattura.
 *
 * Come `report.ts`, qui dentro non c'è rete e non c'è Apify: il giudizio sulle
 * email entra come funzione fornita dal chiamante. Così questa parte resta
 * provabile senza rete — e la porta 25 in uscita da questa macchina è chiusa
 * (DIARIO §7.6), quindi la colonna email sarà spesso parziale per costruzione.
 */

import {
  isEmpty,
  satisfies,
  stableStringify,
  valueAt,
  type FilterRule,
} from "../audit/report.js";

/** Cosa sappiamo dire di un indirizzo. `undecidable` è un esito legittimo. */
export type EmailAdjudication =
  | { verdict: "deliverable" }
  | { verdict: "undeliverable"; reason: string }
  | { verdict: "disposable"; reason: string }
  | { verdict: "role"; reason: string }
  | { verdict: "suspect"; reason: string }
  | { verdict: "undecidable"; reason: string };

/**
 * Gli elenchi esistono a runtime, non solo come tipi: servono al test che
 * verifica che ogni codice emesso abbia un'etichetta nella tabella di
 * localizzazione. Un codice senza etichetta è una spunta verde comprata.
 */
export const VERDICTS = ["good", "rejected", "duplicate", "undecidable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REASON_CODES = ["duplicate", "empty", "filter", "email"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const WARNING_CODES = ["email"] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/**
 * Perché una riga è stata scartata. Sono codici, non frasi: le etichette
 * rivolte all'utente stanno nella tabella di localizzazione, mai qui.
 */
export type Reason =
  | { code: "duplicate"; firstSeenAt: number }
  | { code: "empty"; field: string }
  | { code: "filter"; field: string; rule: FilterRule }
  | { code: "email"; field: string; detail: string };

/** Cose che vale la pena sapere ma che non decidono il verdetto. */
export type Warning = { code: WarningCode; field: string; detail: string };

export interface RecordVerdict {
  /** Posizione nel file consegnato al cliente: senza, non può controllare. */
  index: number;
  verdict: Verdict;
  /** Vuoto quando la riga è buona. */
  reasons: Reason[];
  warnings: Warning[];
  /** Se falso, questa riga non si addebita. */
  billable: boolean;
}

/**
 * La riga che finisce nel dataset del cliente — **una funzione, non un letterale
 * dentro l'attore.**
 *
 * Sta qui perché lo schema di uscita pubblicato (`.actor/dataset_schema.json`)
 * dichiara questi campi, e il diario racconta come è già andata una volta: uno
 * schema che dichiarava campi che l'Actor non scriveva mai, spunta verde e
 * documento che mentiva. Con la forma in un solo posto c'è un test che confronta
 * i campi dichiarati con quelli davvero prodotti, e cade se divergono.
 */
export function verdictRow(r: RecordVerdict): {
  row: number;
  verdict: Verdict;
  charged: boolean;
  reasons: Reason[];
  warnings: Warning[];
} {
  return {
    row: r.index + 1, // il file del cliente comincia da 1
    verdict: r.verdict,
    charged: r.billable,
    reasons: r.reasons,
    warnings: r.warnings,
  };
}

export interface AdjudicateOptions {
  /** Campi che identificano una riga. Vuoto: si confronta la riga intera. */
  dedupeKeys?: string[] | undefined;
  /** Cosa il cliente aveva dichiarato di volere. */
  filters?: FilterRule[] | undefined;
  /** Campo che contiene l'indirizzo di posta, se la colonna serve. */
  emailField?: string | undefined;
  /**
   * Come si giudica un indirizzo. Sincrona e fornita da fuori: il motore non
   * apre connessioni. Senza questa, la colonna email semplicemente non esiste.
   */
  emailLookup?: ((address: string) => EmailAdjudication) | undefined;
  /** Quanto ha pagato in tutto, in dollari. Senza, il costo non si inventa. */
  amountPaidUsd?: number | undefined;
}

export interface AdjudicationSummary {
  total: number;
  good: number;
  rejected: number;
  duplicate: number;
  undecidable: number;
  /** Righe che si addebitano. */
  billable: number;
  /** Righe che NON si addebitano, perché non siamo riusciti a decidere. */
  notBillable: number;
  /** Quello che ha pagato diviso quello che ha davvero ricevuto. */
  costPerGoodRecordUsd: number | null;
}

export interface Adjudication {
  records: RecordVerdict[];
  summary: AdjudicationSummary;
}

/**
 * La chiave di una riga: i campi dichiarati, o la riga intera.
 *
 * Separatore `\u0000`, lo stesso di `audit/report.ts`. Con i valori serializzati
 * da `stableStringify` (le stringhe escono fra virgolette, con gli apici
 * interni protetti) uno spazio basterebbe; ma i due moduli deduplicano la
 * stessa cosa e devono farlo allo stesso modo, e un carattere che non può
 * comparire in un campo di testo non lascia il dubbio aperto a chi legge.
 */
function dedupeKeyOf(row: unknown, keys: string[]): string {
  if (keys.length === 0) return stableStringify(row);
  return keys.map((k) => stableStringify(valueAt(row, k))).join("\u0000");
}

export function adjudicate(rows: unknown[], options: AdjudicateOptions): Adjudication {
  const keys = options.dedupeKeys ?? [];
  const filters = options.filters ?? [];
  const { emailField, emailLookup } = options;

  const firstSeen = new Map<string, number>();
  const records: RecordVerdict[] = [];

  rows.forEach((row, index) => {
    const key = dedupeKeyOf(row, keys);
    const seenAt = firstSeen.get(key);

    // Un doppione non si rigiudica: è già stato giudicato la prima volta.
    // Resta fatturabile — dimostrare che è un doppione è lavoro verificabile.
    if (seenAt !== undefined) {
      records.push({
        index,
        verdict: "duplicate",
        reasons: [{ code: "duplicate", firstSeenAt: seenAt }],
        warnings: [],
        billable: true,
      });
      return;
    }
    firstSeen.set(key, index);

    const reasons: Reason[] = [];
    const warnings: Warning[] = [];

    for (const rule of filters) {
      if (satisfies(row, rule)) continue;
      // Un campo vuoto ha un nome proprio: è la lamentela «campo vuoto ma
      // addebitato lo stesso», e chiamarla «filtro» la renderebbe illeggibile.
      if (rule.op === "nonEmpty") reasons.push({ code: "empty", field: rule.field });
      else reasons.push({ code: "filter", field: rule.field, rule });
    }

    let emailUndecidable = false;
    if (emailField !== undefined && emailLookup !== undefined) {
      const raw = valueAt(row, emailField);
      if (isEmpty(raw) || typeof raw !== "string") {
        // Assente non è indecidibile: è assente, e lo sappiamo con certezza.
        // Non si chiama il giudizio, così non si spreca una richiesta di rete.
        if (!reasons.some((r) => r.code === "empty" && r.field === emailField)) {
          reasons.push({ code: "empty", field: emailField });
        }
      } else {
        const judged = emailLookup(raw);
        switch (judged.verdict) {
          case "undeliverable":
          case "disposable":
            reasons.push({ code: "email", field: emailField, detail: judged.reason });
            break;
          case "role":
          case "suspect":
            // Un indirizzo di ruolo è un lead legittimo per molti compratori:
            // si segnala, non si scarta al posto suo.
            warnings.push({ code: "email", field: emailField, detail: judged.reason });
            break;
          case "undecidable":
            emailUndecidable = true;
            break;
          case "deliverable":
            break;
        }
      }
    }

    // Uno scarto è certo per costruzione: ogni ragione qui sopra è dimostrata.
    // L'indecidibilità conta solo se non c'è già uno scarto.
    const verdict: Verdict =
      reasons.length > 0 ? "rejected" : emailUndecidable ? "undecidable" : "good";

    records.push({
      index,
      verdict,
      reasons,
      warnings,
      billable: verdict !== "undecidable",
    });
  });

  const count = (v: Verdict) => records.filter((r) => r.verdict === v).length;
  const good = count("good");
  const paid = options.amountPaidUsd;

  return {
    records,
    summary: {
      total: rows.length,
      good,
      rejected: count("rejected"),
      duplicate: count("duplicate"),
      undecidable: count("undecidable"),
      billable: records.filter((r) => r.billable).length,
      notBillable: records.filter((r) => !r.billable).length,
      costPerGoodRecordUsd:
        typeof paid === "number" && Number.isFinite(paid) && good > 0 ? paid / good : null,
    },
  };
}

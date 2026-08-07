/**
 * La lista di dimostrazione, per chi preme «Start» senza aver scelto un dataset.
 *
 * Esiste per una ragione precisa e pagata il 7 agosto 2026: `datasetId` era
 * **obbligatorio e senza valore precompilato**, quindi l'attore non era
 * eseguibile con l'input predefinito. Il controllo di qualità automatico di
 * Apify — che esegue ogni attore con lo schema precompilato e si aspetta che
 * finisca entro 5 minuti — non riusciva nemmeno a far PARTIRE una corsa
 * (`invalid-input: Field input.datasetId is required`), e l'attore è stato
 * marcato «Under maintenance» tre giorni dopo la pubblicazione.
 *
 * Il rimedio giusto non era togliere il controllo: era rendere vero quello che
 * il controllo verifica. Premere «Start» senza input adesso mostra **cosa fa lo
 * strumento**, invece di un errore — che è anche il modo in cui un cliente nuovo
 * capisce se gli serve.
 *
 * Tre proprietà che questa lista deve mantenere, e che i test sorvegliano:
 *
 *  1. **produce tutti e quattro i verdetti**, compreso `undecidable`, che è il
 *     differenziale del prodotto: la riga che non si paga;
 *  2. **sta dentro la quota gratuita** (meno di 200 record aggiudicabili),
 *     quindi la dimostrazione non addebita mai niente a nessuno;
 *  3. **usa pochi domini distinti e stabili**, così il giro di DNS è immediato
 *     e la corsa finisce in secondi, non in minuti.
 */

export interface DemoRow {
  id: string;
  company: string;
  region: string;
  email: string;
}

/** Il campo su cui si deduplica, i criteri e la colonna email della dimostrazione. */
export const DEMO_DEDUPE_KEYS = ["id"];
export const DEMO_EMAIL_FIELD = "email";
export const DEMO_FILTERS = [
  { field: "region", op: "equals" as const, value: "Lombardia" },
  { field: "company", op: "nonEmpty" as const },
];

/**
 * 60 record, con l'esito atteso scritto qui accanto per gruppo. Nessuna persona
 * reale: nomi di fantasia su domini pubblici notori.
 */
export function demoRows(): DemoRow[] {
  const righe: DemoRow[] = [];
  const push = (id: string, company: string, region: string, email: string) =>
    righe.push({ id, company, region, email });

  // 20 → buoni. Indirizzo di ruolo su un dominio che accetta posta: verdetto
  // certo, con un avviso («è un ruolo, non una persona»). Si fatturano.
  const ruoli = ["info", "sales", "support", "contact", "hello"];
  for (let i = 0; i < 20; i++) {
    push(`A${i}`, `Alfa ${i} SRL`, "Lombardia", `${ruoli[i % ruoli.length]}@google.com`);
  }

  // 12 → scartati: il dominio dichiara di non accettare posta (RFC 7505).
  for (let i = 0; i < 12; i++) {
    push(`B${i}`, `Beta ${i} SPA`, "Lombardia", `mario.rossi${i}@example.com`);
  }

  // 8 → scartati: casella usa-e-getta.
  for (let i = 0; i < 8; i++) {
    push(`C${i}`, `Gamma ${i} SNC`, "Lombardia", `tizio${i}@mailinator.com`);
  }

  // 6 → scartati: il criterio dichiarato non è rispettato (regione sbagliata).
  for (let i = 0; i < 6; i++) {
    push(`D${i}`, `Delta ${i} SRL`, "Lazio", `info@google.com`);
  }

  // 5 → scartati: un campo che avevi chiesto è vuoto.
  for (let i = 0; i < 5; i++) {
    push(`E${i}`, "", "Lombardia", `info@google.com`);
  }

  // 5 → doppioni del primo record: dimostrabili, quindi si fatturano.
  for (let i = 0; i < 5; i++) push("A0", "Alfa 0 SRL", "Lombardia", "info@google.com");

  // 4 → NON aggiudicabili, ed è il punto: il dominio riceve posta (record A,
  // nessun MX, ripiego RFC 5321) ma se la singola casella esista non si può
  // sapere senza SMTP. Non si addebitano.
  for (let i = 0; i < 4; i++) {
    push(`F${i}`, `Zeta ${i} SRL`, "Lombardia", `mario.rossi${i}@www.google.com`);
  }

  return righe;
}

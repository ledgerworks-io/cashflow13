/**
 * Ingresso dell'attore Apify «Lead Adjudicator».
 *
 * Come per `audit/actor.ts`: sta qui in TypeScript, compilato e provato con il
 * resto, e si limita a prendere l'input, chiamare il motore e consegnare.
 *
 * Due decisioni che valgono più del codice che le implementa:
 *
 * 1. **Prima si consegna, poi si addebita — e la consegna si VERIFICA.** Se
 *    qualcosa si rompe in mezzo, la perdita è nostra. Addebitare e poi non
 *    consegnare è esattamente la lamentela contro cui è costruito questo
 *    prodotto.
 *
 *    L'ordine da solo non bastava, ed è il difetto trovato il 6 agosto 2026:
 *    `fetch` non lancia sui 4xx, quindi le due consegne partivano senza
 *    guardare l'esito. Oltre 9.437.184 byte Apify risponde `413` e non scrive
 *    niente — sopra i ~56.000 record il cliente non riceveva **nessun**
 *    verdetto, il log dichiarava di averli consegnati, e l'addebito partiva
 *    lo stesso. Ora ogni consegna controlla `r.ok` e lancia: se non è
 *    arrivata, `charge()` non viene mai raggiunto.
 * 2. **Il tetto dell'utente lo imponiamo noi.** L'API di Apify non lo fa
 *    rispettare (vedi `billing.ts`): oltre il limite si lavora gratis e si paga
 *    il calcolo.
 */
import { adjudicate, verdictRow, type EmailAdjudication } from "./verdict.js";
import {
  DEMO_DEDUPE_KEYS,
  DEMO_EMAIL_FIELD,
  DEMO_FILTERS,
  demoRows,
} from "./demo.js";
import { buildEmailLookup, nodeDnsResolver } from "./email.js";
import {
  DEFAULT_POLICY,
  computeCharge,
  type ApifyPricingInfo,
  type BillingPolicy,
} from "./billing.js";
import { generateVerdictReceipt } from "./receipt.js";
import { RECEIPT_KEY, chunkForDataset, priceFromRunOrActor } from "./platform.js";
import { valueAt, type FilterRule } from "../audit/report.js";
import type { Locale } from "../i18n/index.js";

const API = "https://api.apify.com/v2";
const TOKEN = process.env["APIFY_TOKEN"] ?? "";
const KV = process.env["ACTOR_DEFAULT_KEY_VALUE_STORE_ID"]
  ?? process.env["APIFY_DEFAULT_KEY_VALUE_STORE_ID"] ?? "";
const DATASET_OUT = process.env["ACTOR_DEFAULT_DATASET_ID"]
  ?? process.env["APIFY_DEFAULT_DATASET_ID"] ?? "";
const RUN_ID = process.env["ACTOR_RUN_ID"] ?? process.env["APIFY_ACTOR_RUN_ID"] ?? "";

/** Il nome dell'evento deve coincidere con quello configurato in console. */
const EVENT = "record-adjudicated";

const auth = { Authorization: `Bearer ${TOKEN}` };

interface ActorInput {
  datasetId?: string;
  dedupeKeys?: string[];
  filters?: FilterRule[];
  emailField?: string;
  amountPaidUsd?: number | string;
  locale?: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...auth, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} su ${url}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

/**
 * Una consegna che deve riuscire, o fermare tutto.
 *
 * `fetch` **non lancia sui 4xx**: senza questo controllo un `413` passava
 * inosservato, il log dichiarava la consegna e l'addebito partiva lo stesso.
 * Qui si lancia apposta, perché più a valle c'è `charge()`: se la consegna non
 * è riuscita, il cliente non deve essere fatturato. La perdita è nostra, ed è
 * il verso giusto in cui sbagliare.
 */
async function consegna(url: string, init: RequestInit, cosa: string): Promise<void> {
  const r = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  if (!r.ok) {
    throw new Error(
      `consegna fallita (${cosa}): ${r.status} — ${(await r.text()).slice(0, 200)}`,
    );
  }
}

/** Tutte le righe, non le prime mille: un conto parziale è un conto sbagliato. */
async function allRows(datasetId: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const step = 1000;
  for (let offset = 0; ; offset += step) {
    const batch = await json<unknown[]>(
      `${API}/datasets/${datasetId}/items?limit=${step}&offset=${offset}`,
    );
    rows.push(...batch);
    if (batch.length < step) break;
  }
  return rows;
}

function toAmount(v: number | string | undefined): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Il prezzo vive in due posti: `DEFAULT_POLICY` e la configurazione in console.
 * Se divergono, la ricevuta dichiarerebbe un numero e l'addebito ne farebbe un
 * altro — cioè saremmo il venditore che nelle recensioni viene accusato di
 * «bait-and-switch». **La console è la fonte di verità**: se dice un prezzo
 * diverso, si usa il suo e lo si urla nei log.
 */
async function leggiPricingInfo(url: string): Promise<ApifyPricingInfo | null> {
  try {
    const r = await fetch(url, { headers: auth });
    if (!r.ok) return null;
    const body = (await r.json()) as {
      data?: { pricingInfo?: ApifyPricingInfo; currentPricingInfo?: ApifyPricingInfo };
    };
    return body.data?.pricingInfo ?? body.data?.currentPricingInfo ?? null;
  } catch {
    return null;
  }
}

async function effectivePolicy(): Promise<BillingPolicy> {
  const actorId = process.env["ACTOR_ID"] ?? process.env["APIFY_ACTOR_ID"] ?? "";

  // La corsa PRIMA dell'attore: `pricingInfo` della corsa è il prezzo risolto
  // per la fascia di CHI CHIAMA, cioè quello che il cliente paga davvero. Su un
  // attore privato `currentPricingInfo` resta `null` (misurato il 6 agosto
  // 2026), quindi leggere solo lì vorrebbe dire non leggere mai niente prima
  // della pubblicazione — e accendere questa difesa per la prima volta in
  // produzione.
  const dallaCorsa = RUN_ID ? await leggiPricingInfo(`${API}/actor-runs/${RUN_ID}`) : null;
  const dallAttore = actorId ? await leggiPricingInfo(`${API}/acts/${actorId}`) : null;

  const { priceUsd, source } = priceFromRunOrActor(dallaCorsa, dallAttore, EVENT);

  if (priceUsd === null) {
    console.warn(
      `prezzo di «${EVENT}» non leggibile né dalla corsa né dall'attore: `
      + `uso il predefinito $${DEFAULT_POLICY.pricePerRecordUsd}`,
    );
    return DEFAULT_POLICY;
  }
  if (priceUsd !== DEFAULT_POLICY.pricePerRecordUsd) {
    console.error(
      `ATTENZIONE: il prezzo applicato (letto da ${source}) è $${priceUsd}, il codice `
      + `dice $${DEFAULT_POLICY.pricePerRecordUsd}. Uso quello della piattaforma, così `
      + `la ricevuta dice la verità. Allineare DEFAULT_POLICY.`,
    );
    return { ...DEFAULT_POLICY, pricePerRecordUsd: priceUsd };
  }
  console.log(`prezzo confermato dalla piattaforma (${source}): $${priceUsd}`);
  return DEFAULT_POLICY;
}

/**
 * Dichiara gli eventi ad Apify. La chiave di idempotenza è legata
 * all'esecuzione: se il processo riparte, non si addebita due volte.
 */
async function charge(events: number): Promise<void> {
  if (events <= 0) {
    console.log("nessun addebito: niente da fatturare in questa esecuzione");
    return;
  }
  const r = await fetch(`${API}/actor-runs/${RUN_ID}/charge`, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/json",
      "idempotency-key": `${RUN_ID}-${EVENT}`,
    },
    body: JSON.stringify({ eventName: EVENT, count: events }),
  });
  if (!r.ok) {
    // Non si rilancia: la ricevuta è già stata consegnata e il cliente non
    // deve perdere il risultato perché la fatturazione ha singhiozzato.
    console.error(`addebito non riuscito (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return;
  }
  console.log(`addebitati ${events} eventi «${EVENT}»`);
}

export async function main(): Promise<void> {
  const input = await json<ActorInput>(`${API}/key-value-stores/${KV}/records/INPUT`);
  const datasetId = input.datasetId;

  const amountPaidUsd = toAmount(input.amountPaidUsd);
  const locale: Locale = input.locale === "it" ? "it" : "en";

  // Senza dataset si mostra cosa fa lo strumento, invece di dare errore.
  // Prima del 7 agosto 2026 qui c'era un `throw`: `datasetId` era obbligatorio
  // e senza valore precompilato, quindi l'attore NON era eseguibile con l'input
  // predefinito — e il controllo di qualità di Apify, che fa esattamente
  // quello, non riusciva nemmeno a far partire una corsa. Vedi `demo.ts`.
  const dimostrazione = !datasetId;
  let rows: unknown[];
  let emailField: string | undefined;
  let dedupeKeys: string[];
  let filters: FilterRule[];
  let sorgente: string;

  if (dimostrazione) {
    console.log(
      "nessun dataset indicato: eseguo la DIMOSTRAZIONE su una lista di esempio. "
      + "Per aggiudicare i tuoi dati, indica «datasetId».",
    );
    rows = demoRows();
    emailField = DEMO_EMAIL_FIELD;
    dedupeKeys = DEMO_DEDUPE_KEYS;
    filters = DEMO_FILTERS;
    sorgente = "DEMO — lista di esempio, non i tuoi dati";
  } else {
    console.log(`dataset: ${datasetId}`);
    rows = await allRows(datasetId!);
    emailField = input.emailField?.trim() || undefined;
    dedupeKeys = input.dedupeKeys ?? [];
    filters = input.filters ?? [];
    sorgente = `dataset ${datasetId}`;
  }
  console.log(`righe lette: ${rows.length}`);

  // I domini si risolvono prima, in blocco e una volta per dominio: il motore
  // resta sincrono e senza rete.
  let emailLookup: ((address: string) => EmailAdjudication) | undefined;
  if (emailField) {
    const indirizzi = rows
      .map((r) => valueAt(r, emailField))
      .filter((v): v is string => typeof v === "string" && v.trim() !== "");
    console.log(`colonna email: ${indirizzi.length} indirizzi da controllare`);
    emailLookup = await buildEmailLookup(indirizzi, nodeDnsResolver());
  }

  const result = adjudicate(rows, {
    dedupeKeys,
    filters,
    ...(emailField ? { emailField, emailLookup } : {}),
    amountPaidUsd,
  });
  const s = result.summary;
  console.log(
    `consegnati ${s.total} · utilizzabili ${s.good} · scartati ${s.rejected} · `
    + `doppioni ${s.duplicate} · non aggiudicati ${s.undecidable}`,
  );

  const policy = await effectivePolicy();
  const platformMax = toAmount(process.env["ACTOR_MAX_TOTAL_CHARGE_USD"]);
  const charged = computeCharge(result, policy, platformMax);
  // La riga che spiega la fattura dice CHI ha deciso, non quali vincoli stanno
  // sotto il lordo: quando ne stanno sotto due, annunciarli entrambi è vero e
  // insieme fuorviante. Il conto era giusto già prima; questa frase è il
  // prodotto tanto quanto il conto.
  const perche = {
    list: `listino pieno: nessun tetto ha tolto niente`,
    cap: `ha deciso il NOSTRO tetto: ${charged.delivered} consegnati × $${policy.capUsdPer1000Delivered.toFixed(2)}/1000 = $${charged.capUsd.toFixed(4)}`,
    platformCap: `ha deciso il tetto della piattaforma: $${(charged.platformCapUsd ?? 0).toFixed(4)}`,
  }[charged.decidedBy];
  console.log(
    `da fatturare: ${charged.adjudicated} aggiudicati − ${charged.free} gratuiti `
    + `= ${charged.chargeable} × $${policy.pricePerRecordUsd} = $${charged.grossUsd.toFixed(4)} lordo `
    + `→ $${charged.totalUsd.toFixed(4)} (${perche})`,
  );

  // --- Prima si consegna -------------------------------------------------
  const xlsx = await generateVerdictReceipt(result, {
    amountPaidUsd,
    locale,
    source: sorgente,
    policy,
  });
  await consegna(
    `${API}/key-value-stores/${KV}/records/${RECEIPT_KEY}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: new Uint8Array(xlsx),
    },
    "ricevuta Excel",
  );
  console.log(`ricevuta Excel: memoria dell'esecuzione, chiave ${RECEIPT_KEY}`);

  // A pezzi sotto il limite della piattaforma: oltre 9.437.184 byte Apify
  // risponde 413 e non scrive NIENTE. In un colpo solo, sopra i ~56.000
  // record, il cliente non riceveva nessun verdetto e veniva fatturato lo
  // stesso.
  const verdetti = result.records.map(verdictRow);
  const pezzi = chunkForDataset(verdetti);
  for (const [i, pezzo] of pezzi.entries()) {
    await consegna(
      `${API}/datasets/${DATASET_OUT}/items`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pezzo) },
      `verdetti, pezzo ${i + 1} di ${pezzi.length}`,
    );
  }
  console.log(
    `verdetti riga per riga: ${verdetti.length} nel dataset dell'esecuzione`
    + (pezzi.length > 1 ? ` (in ${pezzi.length} scaglioni)` : ""),
  );

  // --- Poi si addebita ---------------------------------------------------
  await charge(charged.billedEvents);
  console.log("fatto.");
}

/**
 * Un fallimento deve **restare** un fallimento — l'uscita diversa da zero è
 * quello che fa dire FAILED alla piattaforma, e una corsa FAILED non addebita.
 * Qui si aggiunge solo la spiegazione: fino al 7 agosto 2026 usciva una
 * `RangeError` con lo stack di Node, e il cliente non aveva modo di sapere se
 * gli fosse stato addebitato qualcosa. La risposta è no, sempre, e vale la
 * pena scriverla proprio quando le cose vanno male.
 */
await main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`esecuzione fallita: ${msg}`);
  console.error(
    "NON è stato addebitato niente. Si consegna prima e si addebita dopo, "
    + "quindi una consegna che non riesce non produce nessuna fattura.",
  );
  process.exit(1);
});

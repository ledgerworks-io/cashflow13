/**
 * Ingresso dell'attore Apify «Lead Adjudicator».
 *
 * Come per `audit/actor.ts`: sta qui in TypeScript, compilato e provato con il
 * resto, e si limita a prendere l'input, chiamare il motore e consegnare.
 *
 * Due decisioni che valgono più del codice che le implementa:
 *
 * 1. **Prima si consegna, poi si addebita.** Se qualcosa si rompe in mezzo, la
 *    perdita è nostra. Addebitare e poi non consegnare è esattamente la
 *    lamentela contro cui è costruito questo prodotto.
 * 2. **Il tetto dell'utente lo imponiamo noi.** L'API di Apify non lo fa
 *    rispettare (vedi `billing.ts`): oltre il limite si lavora gratis e si paga
 *    il calcolo.
 */
import { adjudicate, type EmailAdjudication } from "./verdict.js";
import { buildEmailLookup, nodeDnsResolver } from "./email.js";
import {
  DEFAULT_POLICY,
  computeCharge,
  priceFromPricingInfo,
  type ApifyPricingInfo,
  type BillingPolicy,
} from "./billing.js";
import { generateVerdictReceipt } from "./receipt.js";
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
async function effectivePolicy(): Promise<BillingPolicy> {
  const actorId = process.env["ACTOR_ID"] ?? process.env["APIFY_ACTOR_ID"] ?? "";
  if (!actorId) return DEFAULT_POLICY;
  try {
    const r = await fetch(`${API}/acts/${actorId}`, { headers: auth });
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as { data?: { currentPricingInfo?: ApifyPricingInfo } };
    const configurato = priceFromPricingInfo(body.data?.currentPricingInfo, EVENT);
    if (configurato === null) {
      console.warn(`prezzo di «${EVENT}» non leggibile: uso il predefinito $${DEFAULT_POLICY.pricePerRecordUsd}`);
      return DEFAULT_POLICY;
    }
    if (configurato !== DEFAULT_POLICY.pricePerRecordUsd) {
      console.error(
        `ATTENZIONE: il prezzo in console è $${configurato}, il codice dice `
        + `$${DEFAULT_POLICY.pricePerRecordUsd}. Uso quello della console, così la `
        + `ricevuta dice la verità. Allineare DEFAULT_POLICY.`,
      );
      return { ...DEFAULT_POLICY, pricePerRecordUsd: configurato };
    }
    return DEFAULT_POLICY;
  } catch (err) {
    console.warn(`prezzo non verificabile (${String(err)}): uso il predefinito`);
    return DEFAULT_POLICY;
  }
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
  if (!datasetId) throw new Error("manca datasetId: indica il dataset da aggiudicare");

  const amountPaidUsd = toAmount(input.amountPaidUsd);
  const locale: Locale = input.locale === "it" ? "it" : "en";
  const emailField = input.emailField?.trim() || undefined;

  console.log(`dataset: ${datasetId}`);
  const rows = await allRows(datasetId);
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
    dedupeKeys: input.dedupeKeys ?? [],
    filters: input.filters ?? [],
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
  const charged = computeCharge(result, policy, amountPaidUsd, platformMax);
  console.log(
    `da fatturare: ${charged.adjudicated} aggiudicati − ${charged.free} gratuiti `
    + `= ${charged.chargeable} × $${policy.pricePerRecordUsd} → $${charged.totalUsd.toFixed(4)}`
    + (charged.capApplied ? " (tetto del 50% applicato)" : "")
    + (charged.platformCapApplied ? " (tetto della piattaforma applicato)" : ""),
  );

  // --- Prima si consegna -------------------------------------------------
  const xlsx = await generateVerdictReceipt(result, {
    amountPaidUsd,
    locale,
    source: `dataset ${datasetId}`,
    policy,
  });
  await fetch(`${API}/key-value-stores/${KV}/records/OUTPUT.xlsx`, {
    method: "PUT",
    headers: {
      ...auth,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: new Uint8Array(xlsx),
  });
  console.log("ricevuta Excel: memoria dell'esecuzione, chiave OUTPUT.xlsx");

  await fetch(`${API}/datasets/${DATASET_OUT}/items`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(
      result.records.map((r) => ({
        row: r.index + 1,
        verdict: r.verdict,
        charged: r.billable,
        reasons: r.reasons,
        warnings: r.warnings,
      })),
    ),
  });
  console.log("verdetti riga per riga: nel dataset dell'esecuzione");

  // --- Poi si addebita ---------------------------------------------------
  await charge(charged.billedEvents);
  console.log("fatto.");
}

await main();

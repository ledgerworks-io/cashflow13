/**
 * Ingresso dell'attore Apify «Dataset Audit».
 *
 * Sta qui, in TypeScript, e non come file sciolto caricato sulla piattaforma:
 * una sola fonte, compilata e provata come il resto. L'attore si limita a
 * prendere l'input, chiamare il motore e consegnare la ricevuta.
 *
 * Il token iniettato dalla piattaforma è limitato al dataset che l'utente ha
 * scelto nell'input: verificato il 6 agosto 2026, non dedotto dalla
 * documentazione. Tutto il resto dell'account resta inaccessibile.
 */
import { auditDataset, type FilterRule } from "./report.js";
import { generateReceipt } from "./receipt.js";
import type { Locale } from "../i18n/index.js";

const API = "https://api.apify.com/v2";
const TOKEN = process.env["APIFY_TOKEN"] ?? "";
const KV = process.env["ACTOR_DEFAULT_KEY_VALUE_STORE_ID"]
  ?? process.env["APIFY_DEFAULT_KEY_VALUE_STORE_ID"] ?? "";
const DATASET_OUT = process.env["ACTOR_DEFAULT_DATASET_ID"]
  ?? process.env["APIFY_DEFAULT_DATASET_ID"] ?? "";

const auth = { Authorization: `Bearer ${TOKEN}` };

interface ActorInput {
  datasetId?: string;
  dedupeKeys?: string[];
  filters?: FilterRule[];
  amountPaidUsd?: number | string;
  locale?: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...auth, ...(init?.headers ?? {}) } });
  if (!r.ok) {
    throw new Error(`${r.status} su ${url}: ${(await r.text()).slice(0, 200)}`);
  }
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

/** Lo schema manda un numero, ma chi chiama via API può mandare una stringa. */
function toAmount(v: number | string | undefined): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function main(): Promise<void> {
  const input = await json<ActorInput>(`${API}/key-value-stores/${KV}/records/INPUT`);
  const datasetId = input.datasetId;
  if (!datasetId) throw new Error("manca datasetId: indica il dataset da esaminare");

  const amountPaidUsd = toAmount(input.amountPaidUsd);
  const locale: Locale = input.locale === "it" ? "it" : "en";

  console.log(`dataset: ${datasetId}`);
  const rows = await allRows(datasetId);
  console.log(`righe lette: ${rows.length}`);

  const report = auditDataset(rows, {
    dedupeKeys: input.dedupeKeys ?? [],
    filters: input.filters ?? [],
    amountPaidUsd,
  });

  console.log(
    `consegnati ${report.total} · distinti ${report.unique} · `
    + `duplicati ${report.duplicates} · conformi ${report.good}`,
  );
  if (report.costPerGoodRecordUsd !== null && amountPaidUsd !== undefined && report.total > 0) {
    const perDelivered = amountPaidUsd / report.total;
    console.log(
      `costo per record utile: ${report.costPerGoodRecordUsd.toFixed(6)} USD `
      + `(${(report.costPerGoodRecordUsd / perDelivered).toFixed(2)}x il prezzo apparente)`,
    );
  }

  const xlsx = await generateReceipt(report, {
    amountPaidUsd,
    locale,
    source: `dataset ${datasetId}`,
  });
  await fetch(`${API}/key-value-stores/${KV}/records/OUTPUT.xlsx`, {
    method: "PUT",
    headers: {
      ...auth,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    body: new Uint8Array(xlsx),
  });
  console.log("ricevuta Excel: memoria dell'esecuzione, chiave OUTPUT.xlsx");

  await fetch(`${API}/datasets/${DATASET_OUT}/items`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify([{
      datasetId,
      delivered: report.total,
      distinct: report.unique,
      duplicates: report.duplicates,
      matchingYourCriteria: report.good,
      amountPaidUsd: amountPaidUsd ?? null,
      costPerUsableRecordUsd: report.costPerGoodRecordUsd,
      duplicateGroups: report.duplicateGroups.slice(0, 100),
      unmetCriteria: report.violations.map((v) => ({ criterion: v.rule, failing: v.count })),
      emptyFields: report.emptyFields,
    }]),
  });
  console.log("fatto.");
}

await main();

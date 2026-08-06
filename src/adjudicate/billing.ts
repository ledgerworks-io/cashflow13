/**
 * Il conto da presentare.
 *
 * Tre promesse, e sono tutte e tre **dichiarazioni commerciali**: se il codice
 * non le rispetta non è un difetto, è pubblicità ingannevole.
 *
 *   1. non si addebita un record che non abbiamo aggiudicato;
 *   2. i primi 200 record aggiudicati di OGNI esecuzione sono gratuiti;
 *   3. non si addebita mai più di $1,50 ogni 1.000 record consegnati.
 *
 * La terza esiste perché la quota di record aggiudicabili non è sotto il nostro
 * controllo: dipende da quanto sono selettivi i criteri del cliente. Serve nel
 * caso brutto — quando quasi tutto è aggiudicabile e il listino da solo farebbe
 * costare la revisione più del dato che revisiona (su 100.000 record al 63,5%
 * aggiudicabile il listino nudo farebbe $316).
 *
 * **Perché sui CONSEGNATI e non su quanto il cliente dice di aver speso.**
 * Fino al 6 agosto 2026 il tetto era «metà di quanto dichiari». Misurato quel
 * giorno: su 20.000 record con 12.700 aggiudicati con certezza, chi dichiarava
 * $20 pagava $10 e **chi dichiarava $0 pagava $0** — tetto zero, zero eventi.
 * L'importo lo digita il cliente e non è verificabile: l'oggetto corsa altrui è
 * negato ai token a permessi limitati (DIARIO §4.12), e nello schema di input
 * il tipo di risorsa `run` non esiste. Quindi la promessa poggiava sull'onore,
 * proprio nel prodotto che si chiama «paghi solo quello che sappiamo
 * dimostrare».
 *
 * Un pavimento di mercato sotto la dichiarazione non risolve: rimisurato sui
 * 1.629 attori attivi, un pavimento a $0,0005/record sta al **35°** percentile
 * (non al decimo) e contraddirebbe il **41%** delle dichiarazioni oneste.
 *
 * I record consegnati invece li **contiamo noi**, e il cliente può rifare la
 * divisione. Si perde l'aggancio al costo del dato — che con prezzi di mercato
 * da $0,05 a $3,00 ogni 1.000 nessun tetto a record potrebbe mantenere — e si
 * guadagna una promessa che non chiede di fidarsi di niente.
 *
 * `amountPaidUsd` non entra più in questo calcolo. Resta nell'input perché
 * serve alla ricevuta per il costo per record utile: informazione, non
 * fatturazione.
 *
 * **La quota gratuita è per esecuzione e non al mese.** Contare l'uso mensile
 * di un utente vorrebbe dire sapere chi è e ricordarselo: un archivio, cioè
 * l'opposto della garanzia «zero archivio» su cui è costruito l'accordo sul
 * trattamento dei dati.
 */

import type { Adjudication } from "./verdict.js";

export interface BillingPolicy {
  /** Record aggiudicati gratuiti in ogni esecuzione. */
  freePerRun: number;
  /** Prezzo per record aggiudicato oltre la quota gratuita, in dollari. */
  pricePerRecordUsd: number;
  /**
   * Tetto, in dollari ogni 1.000 record **consegnati**.
   *
   * Proporzionale, non a migliaia intere: a scatti ci sarebbe un gradino del
   * 100% fra 1.000 e 1.001 record, che è il genere di cosa che si ritrova
   * scritta in una recensione da una stella.
   */
  capUsdPer1000Delivered: number;
}

/**
 * I numeri pubblicati. Stanno qui e in nessun altro posto: la scheda del
 * prodotto e il codice devono dire la stessa cosa, e c'è un test che lo
 * verifica. Cambiarli è una modifica significativa su Apify — preavviso di
 * 14 giorni, una al mese, e non si può annullare.
 */
export const DEFAULT_POLICY: BillingPolicy = {
  freePerRun: 200,
  pricePerRecordUsd: 0.005,
  capUsdPer1000Delivered: 1.5,
};

/**
 * La forma con cui Apify espone il prezzo di un attore, ridotta a quello che
 * serve. Verificato sulle risposte vere di `/v2/store` il 6 agosto 2026.
 */
export interface ApifyPricingInfo {
  pricingModel?: string;
  pricingPerEvent?: {
    actorChargeEvents?: Record<string, {
      eventPriceUsd?: number;
      eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd?: number }>;
    }>;
  };
}

/**
 * Il prezzo **davvero configurato** in console per un evento, sulla fascia
 * FREE — che è la più alta e quella che paga la maggioranza.
 *
 * Serve perché il prezzo vive in due posti: qui e sulla piattaforma. Se
 * divergono, la ricevuta dichiara un numero e l'addebito ne fa un altro, e
 * saremmo esattamente il venditore che nelle recensioni viene accusato di
 * «bait-and-switch». `null` se non si riesce a leggerlo: meglio non sapere che
 * credere a un numero sbagliato.
 */
export function priceFromPricingInfo(
  info: ApifyPricingInfo | null | undefined,
  eventName: string,
): number | null {
  const ev = info?.pricingPerEvent?.actorChargeEvents?.[eventName];
  if (!ev) return null;
  const tiered = ev.eventTieredPricingUsd?.["FREE"]?.tieredEventPriceUsd;
  if (typeof tiered === "number" && Number.isFinite(tiered) && tiered >= 0) return tiered;
  if (typeof ev.eventPriceUsd === "number" && Number.isFinite(ev.eventPriceUsd) && ev.eventPriceUsd >= 0) {
    return ev.eventPriceUsd;
  }
  return null;
}

export interface Charge {
  /** Record consegnati dal cliente. È la base su cui si calcola il tetto. */
  delivered: number;
  /** Record con un verdetto certo. Gli indecidibili non sono qui. */
  adjudicated: number;
  /** Quanti dei precedenti sono coperti dalla quota gratuita. */
  free: number;
  /** Quanti si pagano davvero. */
  chargeable: number;
  /** Quanto costerebbero senza il tetto. */
  grossUsd: number;
  /** Il tetto: consegnati ÷ 1.000 × la tariffa. Sempre un numero, mai assente. */
  capUsd: number;
  /**
   * Vero quando questo tetto sta **sotto** il lordo. Attenzione: non significa
   * che abbia deciso il totale — quando due tetti stanno entrambi sotto, sono
   * veri entrambi. Per sapere chi ha deciso c'è `decidedBy`.
   */
  capApplied: boolean;
  /** Il massimo che la piattaforma consente per questa esecuzione. */
  platformCapUsd: number | null;
  /** Come `capApplied`: «sta sotto il lordo», non «ha deciso». */
  platformCapApplied: boolean;
  /**
   * Chi ha **determinato** il totale, cioè quale dei tre vincoli è il minimo.
   *
   * Esiste perché fino al 7 agosto 2026 il log dell'esecuzione annunciava
   * «tetto applicato» e «tetto della piattaforma applicato» insieme, quando a
   * decidere era uno solo: il conto era giusto e la frase no. In un prodotto
   * che vende trasparenza sulla fattura, la riga che spiega la fattura è
   * parte del prodotto.
   */
  decidedBy: "list" | "cap" | "platformCap";
  /** Quello che si addebita. */
  totalUsd: number;
  /**
   * Il numero di eventi da dichiarare ad Apify — che conta eventi, non dollari.
   * Arrotondato **per difetto**: fra addebitare un centesimo di troppo e uno di
   * meno, si sceglie sempre di meno.
   */
  billedEvents: number;
}

/** I dollari si arrotondano al millesimo di centesimo: sotto c'è solo deriva binaria. */
function usd(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Un importo che si può usare come tetto: finito e non negativo. */
function tetto(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function computeCharge(
  adjudication: Adjudication,
  policy: BillingPolicy = DEFAULT_POLICY,
  /**
   * `ACTOR_MAX_TOTAL_CHARGE_USD`, il massimo che l'utente ha autorizzato.
   * **L'API di Apify non lo fa rispettare**: dalla risposta 201 di
   * `POST /v2/actor-runs/{runId}/charge` — «the API does not check this. Above
   * the limit, the charges reported as successful in API will not be added to
   * your payouts, but you will still bear the associated costs.» Cioè: oltre
   * il tetto si lavora gratis e si paga il calcolo. Lo imponiamo qui.
   */
  platformMaxUsd?: number,
): Charge {
  // Promessa 1: la base imponibile è `billable`, non `total`. Gli indecidibili
  // non compaiono in questo conto in nessun modo.
  const adjudicated = adjudication.summary.billable;

  // Promessa 2.
  const free = Math.min(adjudicated, Math.max(0, policy.freePerRun));
  const chargeable = adjudicated - free;
  const grossUsd = usd(chargeable * policy.pricePerRecordUsd);

  // Promessa 3. Il tetto discende dai record CONSEGNATI: li contiamo noi, il
  // cliente rifà la divisione, e non c'è niente da dichiarare per ottenere uno
  // sconto. Proporzionale, così non c'è nessun gradino a ogni migliaio.
  const delivered = Math.max(0, adjudication.summary.total);
  const capUsd = usd((delivered / 1000) * Math.max(0, policy.capUsdPer1000Delivered));
  const platformCapUsd = tetto(platformMaxUsd);

  // Vince sempre il più basso: la nostra promessa e il tetto della piattaforma
  // sono due vincoli separati e devono valere entrambi.
  const totalUsd = Math.min(
    grossUsd,
    capUsd,
    platformCapUsd ?? Number.POSITIVE_INFINITY,
  );

  // Chi ha deciso, si guarda PRIMA dell'arrotondamento: `platformCapUsd` arriva
  // grezzo dalla piattaforma e `usd()` potrebbe spostarlo di un millesimo di
  // centesimo, facendo sembrare che abbia deciso qualcun altro. A parità vince
  // il listino: se il lordo è già il minimo, nessun tetto ha tolto niente.
  const decidedBy: Charge["decidedBy"] =
    totalUsd === grossUsd ? "list" : totalUsd === capUsd ? "cap" : "platformCap";

  // Da dollari a eventi. Il 1e-9 assorbe la deriva binaria (4800*0.005 può
  // valere 23.999999999996): senza, si perderebbe un evento ogni tanto.
  const billedEvents =
    policy.pricePerRecordUsd > 0
      ? Math.min(chargeable, Math.floor(totalUsd / policy.pricePerRecordUsd + 1e-9))
      : 0;

  return {
    delivered,
    adjudicated,
    free,
    chargeable,
    grossUsd,
    capUsd,
    capApplied: capUsd < grossUsd,
    platformCapUsd,
    platformCapApplied: platformCapUsd !== null && platformCapUsd < grossUsd,
    decidedBy,
    totalUsd: usd(totalUsd),
    billedEvents,
  };
}

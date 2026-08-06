import { describe, expect, it } from "vitest";

import {
  buildEmailLookup,
  classifyWithoutNetwork,
  leggiMx,
  type DomainFacts,
  type DomainResolver,
} from "../src/adjudicate/email.js";

/**
 * La colonna email.
 *
 * Non può stabilire se una casella esiste: quello richiede la porta 25, che
 * Hetzner tiene chiusa in uscita (DIARIO §7.6). Può stabilire tutto il resto —
 * e la cosa importante è che **dica di non sapere quando non sa**, perché è
 * quel verdetto che rende un record gratuito.
 *
 * Le percentuali di copertura misurate dallo spike (DIARIO §12) sono fissate
 * nel test della garanzia; qui si prova il comportamento caso per caso.
 *
 * Nessun test qui tocca la rete: il risolutore è iniettato.
 */

const VIVO: DomainFacts = { status: "NOERROR", mx: ["mx.azienda.com"], hasA: true };
const SENZA_POSTA: DomainFacts = { status: "NOERROR", mx: [], hasA: false };
const SOLO_A: DomainFacts = { status: "NOERROR", mx: [], hasA: true };
const INESISTENTE: DomainFacts = { status: "NXDOMAIN", mx: [], hasA: false };
const IRRAGGIUNGIBILE: DomainFacts = { status: "TIMEOUT", mx: [], hasA: false };
/** `MX 0 .` — il dominio dichiara di non accettare posta. RFC 7505. */
const MX_NULLO: DomainFacts = { status: "NULL_MX", mx: [], hasA: false };

function risolutore(mappa: Record<string, DomainFacts>, contatore?: { n: number }): DomainResolver {
  return async (dominio) => {
    if (contatore) contatore.n += 1;
    return mappa[dominio] ?? VIVO;
  };
}

async function giudica(
  indirizzi: string[],
  mappa: Record<string, DomainFacts> = {},
  contatore?: { n: number },
) {
  const lookup = await buildEmailLookup(indirizzi, risolutore(mappa, contatore));
  return lookup;
}

describe("quello che si decide senza chiedere niente a nessuno", () => {
  it("una sintassi rotta è morta, e non serve la rete per saperlo", () => {
    for (const brutto of ["senza-chiocciola", "@senza-locale.com", "due@@chiocciole.com",
      "spazio dentro@x.com", "punto..doppio@x.com", ".iniziale@x.com", "finale.@x.com"]) {
      const v = classifyWithoutNetwork(brutto);
      expect(v?.verdict, brutto).toBe("undeliverable");
    }
  });

  it("un dominio usa-e-getta è certo, e non serve la rete", () => {
    expect(classifyWithoutNetwork("tizio@mailinator.com")?.verdict).toBe("disposable");
  });

  it("su un indirizzo normale non si pronuncia: serve il DNS", () => {
    expect(classifyWithoutNetwork("mario@azienda.com")).toBeNull();
  });
});

describe("quello che decide il DNS", () => {
  it("dominio inesistente: morto, con certezza", async () => {
    const l = await giudica(["x@niente.com"], { "niente.com": INESISTENTE });
    expect(l("x@niente.com").verdict).toBe("undeliverable");
  });

  it("dominio senza MX e senza A: morto, con certezza", async () => {
    const l = await giudica(["x@vuoto.com"], { "vuoto.com": SENZA_POSTA });
    expect(l("x@vuoto.com").verdict).toBe("undeliverable");
  });

  it("dominio con A ma senza MX NON è morto: la regola di ripiego RFC 5321", async () => {
    // Il caso vero sono `www.google.com` e `news.ycombinator.com`: record A e
    // NESSUN record MX. Chi "aggiusta" il codice perché fallisca sta rompendo
    // una regola del protocollo.
    //
    // ATTENZIONE: `example.com` NON sta qui — pubblica un MX nullo, che è il
    // caso opposto. Vedi il gruppo di prove qui sotto.
    const l = await giudica(["x@solo-a.com"], { "solo-a.com": SOLO_A });
    expect(l("x@solo-a.com").verdict).toBe("undecidable");
  });

  it("DNS irraggiungibile: indecidibile, quindi gratuito — mai un verdetto inventato", async () => {
    const l = await giudica(["x@boh.com"], { "boh.com": IRRAGGIUNGIBILE });
    expect(l("x@boh.com").verdict).toBe("undecidable");
  });
});

/**
 * Il MX nullo — `MX 0 .` — non è un MX: è la dichiarazione esplicita, per
 * RFC 7505, che il dominio **non accetta posta**.
 *
 * Sta qui perché era un difetto vero, trovato il 6 agosto 2026 rifacendo le
 * misure: `example.com` e `chiriba.it` pubblicano entrambi un MX nullo, e il
 * codice li dichiarava «the domain accepts mail». Erano casi DECIDIBILI
 * dichiarati indecidibili — cioè lo strumento rinunciava a fare il suo mestiere
 * proprio dove poteva farlo con certezza.
 *
 * `leggiMx` è una funzione pura apposta: la traduzione da risposta DNS a fatti
 * era la cucitura non sorvegliata da nessun test, ed è esattamente lì che il
 * difetto viveva.
 */
describe("il MX nullo: RFC 7505", () => {
  it("un MX nullo è un dominio morto, con certezza — quindi si addebita", async () => {
    const l = await giudica(["x@niente-posta.com"], { "niente-posta.com": MX_NULLO });
    expect(l("x@niente-posta.com").verdict).toBe("undeliverable");
  });

  it("il MX nullo BATTE il ripiego sul record A: con A e MX nullo resta morto", async () => {
    // È il caso di `example.com`: ha due record A e un MX nullo. Se il ripiego
    // RFC 5321 vincesse, diremmo «accetta posta» di un dominio che dichiara
    // per iscritto il contrario.
    const conA: DomainFacts = { status: "NULL_MX", mx: [], hasA: true };
    const l = await giudica(["x@example-like.com"], { "example-like.com": conA });
    expect(l("x@example-like.com").verdict).toBe("undeliverable");
  });

  it("la ragione dice al cliente perché, e nomina la regola", async () => {
    const l = await giudica(["x@niente-posta.com"], { "niente-posta.com": MX_NULLO });
    const v = l("x@niente-posta.com");
    expect(v).toHaveProperty("reason");
    expect("reason" in v ? v.reason : "").toMatch(/null MX/i);
  });

  describe("leggiMx — la cucitura fra risposta DNS e fatti", () => {
    it("nessun record: non decide, si passa al ripiego sul record A", () => {
      expect(leggiMx([])).toEqual({ kind: "none" });
    });

    it("bersaglio vuoto: è un MX nullo", () => {
      expect(leggiMx([{ exchange: "" }])).toEqual({ kind: "null-mx" });
    });

    it("bersaglio radice, con e senza punto finale: è un MX nullo", () => {
      // node restituisce "", dig mostra "."; entrambi sono la radice.
      expect(leggiMx([{ exchange: "." }])).toEqual({ kind: "null-mx" });
      expect(leggiMx([{ exchange: " . " }])).toEqual({ kind: "null-mx" });
    });

    it("server veri: si usano, normalizzati", () => {
      expect(leggiMx([{ exchange: "MX1.Azienda.com" }, { exchange: "mx2.azienda.com" }]))
        .toEqual({ kind: "servers", mx: ["mx1.azienda.com", "mx2.azienda.com"] });
    });

    it("misto malformato: il bersaglio nullo si scarta, i server veri vincono", () => {
      // RFC 7505: il MX nullo dev'essere l'unico record. Se non lo è, la zona è
      // sbagliata — e fra dichiarare morto un dominio che ha server veri e
      // ignorare un record malformato, si sceglie di non fare danno.
      expect(leggiMx([{ exchange: "." }, { exchange: "mx.azienda.com" }]))
        .toEqual({ kind: "servers", mx: ["mx.azienda.com"] });
    });
  });
});

describe("quello che si segnala senza scartare", () => {
  it("un indirizzo di ruolo è un verdetto certo, non uno scarto", async () => {
    const l = await giudica(["info@azienda.com"]);
    expect(l("info@azienda.com").verdict).toBe("role");
  });

  it("un errore di battitura di un provider noto è sospetto", async () => {
    const l = await giudica(["mario@gmial.com", "mario@hotmial.com"]);
    expect(l("mario@gmial.com").verdict).toBe("suspect");
    expect(l("mario@hotmial.com").verdict).toBe("suspect");
  });

  it("un dominio davvero diverso non viene scambiato per un errore di battitura", async () => {
    const l = await giudica(["mario@gmail.com", "mario@azienda-seria.com"]);
    expect(l("mario@gmail.com").verdict).toBe("undecidable");
    expect(l("mario@azienda-seria.com").verdict).toBe("undecidable");
  });
});

describe("il caso che decide il prezzo", () => {
  it("indirizzo personale a dominio vero: NON lo sappiamo, e lo diciamo", async () => {
    // È il 70% di una lista B2B. Se un giorno questo test dicesse "deliverable"
    // staremmo fatturando record che non abbiamo aggiudicato.
    const l = await giudica(["mario.rossi@azienda.com"]);
    const v = l("mario.rossi@azienda.com");
    expect(v.verdict).toBe("undecidable");
    expect(v).toHaveProperty("reason");
  });

  it("un provider di massa è indecidibile quanto un dominio aziendale", async () => {
    const l = await giudica(["tizio@gmail.com"]);
    expect(l("tizio@gmail.com").verdict).toBe("undecidable");
  });
});

describe("costo e robustezza", () => {
  it("interroga ogni dominio UNA volta sola, non una per indirizzo", async () => {
    const c = { n: 0 };
    await giudica(
      ["a@azienda.com", "b@azienda.com", "c@azienda.com", "d@altra.com"],
      {},
      c,
    );
    expect(c.n).toBe(2);
  });

  it("non interroga il DNS per quello che è già deciso senza rete", async () => {
    const c = { n: 0 };
    await giudica(["rotta", "x@mailinator.com"], {}, c);
    expect(c.n).toBe(0);
  });

  it("un risolutore che esplode non fa esplodere l'aggiudicazione", async () => {
    const lookup = await buildEmailLookup(["x@boom.com"], async () => {
      throw new Error("rete a pezzi");
    });
    expect(lookup("x@boom.com").verdict).toBe("undecidable");
  });

  it("un indirizzo mai risolto è indecidibile, non un errore", async () => {
    const l = await giudica(["noto@azienda.com"]);
    expect(l("mai-visto@altrove.com").verdict).toBe("undecidable");
  });

  it("il confronto non è sensibile a maiuscole e spazi", async () => {
    const l = await giudica(["  Mario@Azienda.COM  "]);
    expect(l("mario@azienda.com").verdict).toBe("undecidable");
    expect(l("  MARIO@AZIENDA.com ").verdict).toBe("undecidable");
  });

  it("una lista vuota non fa esplodere niente", async () => {
    const l = await buildEmailLookup([], async () => VIVO);
    expect(l("qualsiasi@cosa.com").verdict).toBe("undecidable");
  });
});

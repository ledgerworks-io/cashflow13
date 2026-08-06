import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",

      /**
       * La copertura sorveglia il NUCLEO DI CALCOLO, che è dove «la correttezza
       * è il prodotto»: il motore del piano, la cartella Excel, l'aggiudicatore,
       * il revisore, le etichette.
       *
       * Fino al 6 agosto 2026 qui c'era `src/**` con soglie all'80%, ma il
       * pacchetto `@vitest/coverage-v8` non era installato: `--coverage`
       * falliva e il cancello non si era mai chiuso una volta. Soglie che non
       * girano sono peggio di nessuna soglia — dichiarano un controllo che non
       * esiste.
       *
       * Quello che resta fuori sta scritto sotto, uno per uno, col motivo. Non
       * è coperto e non si finge che lo sia: è la parte che il protocollo di
       * verifica elenca come «mai provata davvero», e si prova con
       * un'esecuzione vera sulla piattaforma, non con un test che finge la
       * piattaforma.
       */
      include: [
        "src/engine/**/*.ts",
        "src/excel/**/*.ts",
        "src/i18n/**/*.ts",
        "src/audit/report.ts",
        "src/audit/receipt.ts",
        "src/adjudicate/billing.ts",
        "src/adjudicate/verdict.ts",
        "src/adjudicate/receipt.ts",
        "src/adjudicate/email.ts",
        "src/delivery/store.ts",
      ],
      exclude: [
        // Punti d'ingresso: prendono l'input dalla piattaforma, chiamano il
        // nucleo e consegnano. Non contengono decisioni commerciali.
        "src/index.ts",         // server HTTP
        "src/stdio.ts",         // trasporto stdio
        "src/audit/actor.ts",   // ingresso Actor: dataset-audit
        "src/adjudicate/actor.ts", // ingresso Actor: lead-adjudicator
        // Rete e piattaforma: si provano con un'esecuzione vera, non simulata.
        "src/delivery/apify-store.ts",
        "src/delivery/tool.ts",
        "src/delivery/local.ts",
        "src/version.ts",
      ],

      /**
       * Le soglie sono quelle che il nucleo raggiunge DAVVERO oggi, arrotondate
       * per difetto. Servono a impedire un arretramento, non a fare bella
       * figura: si alzano quando sale la copertura, non si abbassano quando
       * scende.
       */
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
  },
});

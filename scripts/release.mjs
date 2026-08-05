/**
 * Il ciclo di rilascio, in un comando solo.
 *
 *   node scripts/release.mjs            → prepara e si ferma sulla soglia
 *   node scripts/release.mjs --publish  → attraversa la soglia
 *   node scripts/release.mjs --version 0.2.0 --publish
 *
 * Perche' esiste: il 5 agosto 2026 questa catena l'abbiamo percorsa a mano in
 * una dozzina di passaggi, e ne abbiamo sbagliati due — la versione in
 * server.json diversa da quella in package.json, e un pacchetto .mcpb allegato
 * a un rilascio che non corrispondeva al commit. Sono errori che non si notano
 * guardando: si scoprono da un utente.
 *
 * Il confine e' esplicito. Senza --publish non esce niente dalla macchina:
 * si compila, si prova, si impacchetta, e si mostra cosa STAREBBE per uscire.
 * Un comando che pubblica per distrazione non lo vogliamo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const argomenti = process.argv.slice(2);
const pubblica = argomenti.includes("--publish");
const versioneRichiesta = argomenti[argomenti.indexOf("--version") + 1];

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: radice, encoding: "utf8", ...opts }).trim();

const passo = (t) => console.log(`\n\x1b[1m▸ ${t}\x1b[0m`);
const ok = (t) => console.log(`  ✓ ${t}`);
const nota = (t) => console.log(`  · ${t}`);

// --- 1. L'albero dev'essere pulito ---------------------------------------
// Rilasciare con modifiche non committate significa spedire un pacchetto che
// non corrisponde a nessun commit: irripetibile, e impossibile da diagnosticare.
passo("Stato del repository");
const sporco = sh("git", ["status", "--porcelain"]);
if (sporco) {
  console.error("  ✗ ci sono modifiche non committate:\n" + sporco);
  process.exit(1);
}
ok(`albero pulito, su ${sh("git", ["rev-parse", "--abbrev-ref", "HEAD"])}`);

// --- 2. Correttezza -------------------------------------------------------
passo("Test e tipi");
sh("npm", ["run", "typecheck"]);
ok("typecheck");
const test = sh("npx", ["vitest", "run"]);
ok(test.split("\n").find((r) => r.includes("Tests"))?.trim() ?? "test passati");

// --- 3. Versione, in un posto solo ---------------------------------------
passo("Versione");
const pkgPath = join(radice, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (versioneRichiesta && versioneRichiesta !== pkg.version) {
  sh("npm", ["version", versioneRichiesta, "--no-git-tag-version"]);
  pkg.version = versioneRichiesta;
  ok(`package.json portato a ${versioneRichiesta}`);
}
const versione = pkg.version;

// server.json e manifest MCPB seguono package.json: una fonte sola, niente deriva.
for (const [file, chiave] of [["server.json", "version"], ["mcpb/manifest.json", "version"]]) {
  const p = join(radice, file);
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, "utf8"));
  if (j[chiave] !== versione) {
    j[chiave] = versione;
    writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
    ok(`${file} allineato a ${versione}`);
  } else {
    nota(`${file} già a ${versione}`);
  }
}

// --- 4. Compilazione e pacchetto ------------------------------------------
passo("Compilazione e pacchetto desktop");
sh("npm", ["run", "build"]);
ok("dist/");
sh("node", [join(radice, "scripts", "build-mcpb.mjs")], { stdio: "ignore" });
const mcpb = join(radice, "build", `cashflow13-${versione}.mcpb`);
if (!existsSync(mcpb)) {
  console.error(`  ✗ pacchetto non prodotto: ${mcpb}`);
  process.exit(1);
}
ok(`${mcpb.replace(radice + "/", "")}`);

// --- La soglia ------------------------------------------------------------
if (!pubblica) {
  passo("Fermo sulla soglia");
  console.log(`
  Da qui in poi si esce dalla macchina. NON è stato pubblicato niente.
  Quello che accadrebbe con --publish:

    · commit delle versioni allineate, se cambiate
    · tag v${versione} e push su origin/main
    · rilascio GitHub v${versione} con il pacchetto .mcpb allegato
    · voce it.chiriba/cashflow13 ${versione} nel registro MCP
    · ricompilazione dell'attore Apify dal ramo main

  Per procedere:  node scripts/release.mjs --publish
`);
  process.exit(0);
}

// --- 5. Oltre la soglia ---------------------------------------------------
passo("Commit e tag");
if (sh("git", ["status", "--porcelain"])) {
  sh("git", ["add", "-A"]);
  sh("git", ["commit", "-m", `Versione ${versione}`]);
  ok("versioni allineate committate");
}
const tag = `v${versione}`;
const tagEsiste = sh("git", ["tag", "-l", tag]) === tag;
if (!tagEsiste) {
  sh("git", ["tag", "-a", tag, "-m", `${tag}\n\nDa qui decorrono i quattro anni della licenza BUSL.`]);
  ok(`tag ${tag}`);
} else {
  nota(`tag ${tag} già presente`);
}
sh("git", ["push", "origin", "main", "--follow-tags"]);
ok("spinto su origin/main");

passo("Rilascio GitHub");
try {
  sh("gh", ["release", "create", tag, mcpb, "--title", `${tag} — 13-Week Cash Flow Plan`,
    "--notes", `Estensione desktop: scarica il .mcpb e aprilo con Claude Desktop.\nServer remoto: https://mcp.chiriba.it/mcp\nRegistro MCP: it.chiriba/cashflow13`]);
  ok(`rilascio ${tag} con il pacchetto allegato`);
} catch {
  sh("gh", ["release", "upload", tag, mcpb, "--clobber"]);
  ok(`rilascio ${tag} già esistente, pacchetto aggiornato`);
}

passo("Registro MCP");
try {
  sh("mcp-publisher", ["publish"]);
  ok(`it.chiriba/cashflow13 ${versione}`);
} catch (e) {
  console.error("  ✗ pubblicazione nel registro fallita — serve di nuovo il login DNS:");
  console.error("    vedi /etc/mcp-registry/LEGGIMI.txt");
  throw e;
}

passo("Attore Apify");
const tokenFile = "/etc/apify/token.env";
if (!existsSync(tokenFile)) {
  nota("token Apify assente: ricompilazione saltata");
} else {
  const token = readFileSync(tokenFile, "utf8").split("=")[1]?.trim();
  const r = await fetch(
    "https://api.apify.com/v2/acts/wMwjG0Uai2YOpjKdP/builds?version=0.0&tag=latest&useCache=true",
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  const j = await r.json();
  if (j.data?.id) ok(`compilazione avviata: ${j.data.id}`);
  else nota(`ricompilazione non avviata: ${JSON.stringify(j.error ?? j)}`);
}

console.log(`\n\x1b[1m${versione} pubblicata.\x1b[0m\n`);

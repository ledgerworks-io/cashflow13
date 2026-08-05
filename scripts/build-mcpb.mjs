/**
 * Costruisce il pacchetto .mcpb per l'estensione desktop.
 *
 * Il pacchetto contiene un server che gira in LOCALE: e' una copia del codice
 * sulla macchina dell'utente, non un puntatore a mcp.chiriba.it. Va rigenerato
 * a ogni versione, e la versione nel manifest deve seguire package.json.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(radice, "build", "mcpb");
const pkg = JSON.parse(readFileSync(join(radice, "package.json"), "utf8"));

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });

cpSync(join(radice, "dist"), join(build, "dist"), { recursive: true });
cpSync(join(radice, "package.json"), join(build, "package.json"));
cpSync(join(radice, "LICENSE"), join(build, "LICENSE"));

// Il manifest vive nel repo; la versione la prende da package.json, cosi' non
// esistono due numeri che possono divergere.
const manifest = JSON.parse(readFileSync(join(radice, "mcpb", "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(build, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--silent"], {
  cwd: build, stdio: "inherit",
});
rmSync(join(build, "package-lock.json"), { force: true });

execFileSync("mcpb", ["pack", ".", join(radice, "build", `cashflow13-${pkg.version}.mcpb`)], {
  cwd: build, stdio: "inherit",
});

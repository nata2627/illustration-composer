// Measures scenario 1 (dictionary) on tests/fixtures/headlines-eval.json.
// found: share of headlines where the dictionary matched anything (no default set);
// hit: share of headlines where at least one main object is in the "ok" list;
// precision: share of chosen main objects that are in the "ok" list, over found headlines.
// Only dev misses are printed: test headlines are measured, never used for tuning.
//   npm run eval                 print the metrics
//   npm run eval -- results/x.json   also write them to a file
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pickForMetaphor } from "../src/match";

interface Headline {
  split: "dev" | "test";
  text: string;
  ok: string[];
}

const { headlines }: { headlines: Headline[] } = JSON.parse(readFileSync("tests/fixtures/headlines-eval.json", "utf8"));

function measure(split: Headline["split"]) {
  const set = headlines.filter((h) => h.split === split);
  let found = 0;
  let hit = 0;
  let mainTotal = 0;
  let mainOk = 0;
  const misses: string[] = [];
  for (const h of set) {
    const r = pickForMetaphor(h.text);
    const main = r.picks.filter((p) => p.variant === "main").map((p) => p.objectId);
    if (r.fallback) {
      misses.push(`${h.text}  ->  default set`);
      continue;
    }
    found++;
    mainTotal += main.length;
    const good = main.filter((id) => h.ok.includes(id));
    mainOk += good.length;
    if (good.length) hit++;
    else misses.push(`${h.text}  ->  ${main.join(", ")}`);
  }
  return { headlines: set.length, found, hit, mainOk, mainTotal, misses };
}

const result = { dev: measure("dev"), test: measure("test") };
const pct = (a: number, b: number) => `${a} из ${b} (${Math.round((100 * a) / b)}%)`;
for (const split of ["dev", "test"] as const) {
  const m = result[split];
  console.log(
    `${split}: найдено ${pct(m.found, m.headlines)}, попадание ${pct(m.hit, m.headlines)}, точность главных ${pct(m.mainOk, m.mainTotal)}`,
  );
}
console.log("\nпромахи dev:\n" + result.dev.misses.map((m) => "  " + m).join("\n"));

const out = process.argv[2];
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  const strip = ({ misses: _misses, ...rest }: ReturnType<typeof measure>) => rest;
  writeFileSync(out, JSON.stringify({ dev: strip(result.dev), test: strip(result.test) }, null, 2) + "\n");
}

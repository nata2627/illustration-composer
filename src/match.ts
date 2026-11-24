import { META, OBJECT_IDS } from "./library";
import type { Pick } from "./layout";

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

export function tokens(text: string): string[] {
  return normalize(text).match(/[a-zа-я0-9]+/g) ?? [];
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Rough Russian stem: drop the case ending so "лампу", "лампой", "лампы" all meet "лампа".
function stem(word: string): string {
  return word.length > 4 ? word.replace(/(ами|ями|ов|ев|ей|ой|ом|ем|ам|ям|ах|ях|ою|ию|ия|ье|а|я|у|ю|ы|и|о|е|ь|й)$/, "") : word;
}

export function matchObjectWord(token: string): string | null {
  const t = stem(normalize(token));
  if (t.length < 3) return null;
  for (const id of OBJECT_IDS) {
    for (const w of META[id].words) {
      const s = stem(normalize(w));
      if (t === s) return id;
    }
  }
  // one typo is allowed only for words long enough not to collide
  for (const id of OBJECT_IDS) {
    for (const w of META[id].words) {
      const s = stem(normalize(w));
      if (s.length >= 4 && levenshtein(t, s) <= 1) return id;
    }
  }
  return null;
}

export interface NamesResult {
  picks: Pick[];
  unknown: string[];
}

const BG_WORDS = /^(фон|монохром|бледн|сер)/;
const SKIP = new Set(["и", "с", "со", "на", "под", "в", "а", "еще", "плюс", "или"]);

// Scenario 2: "наушники, лампу и фоновую книгу" -> headphones, lamp, book (background variant).
export function parseNames(text: string): NamesResult {
  const picks: Pick[] = [];
  const unknown: string[] = [];
  let bgNext = false;
  let lastWasObject = false;
  for (const tok of tokens(text)) {
    if (tok === "и" || tok === "плюс") lastWasObject = false;
    if (SKIP.has(tok)) continue;
    if (BG_WORDS.test(tok)) {
      bgNext = true;
      continue;
    }
    const id = matchObjectWord(tok);
    if (id) {
      // "ваза с тюльпанами" names one object with two words
      const prev = picks[picks.length - 1];
      if (prev && prev.objectId === id && lastWasObject) continue;
      picks.push({ objectId: id, variant: bgNext ? "bg" : "main" });
      bgNext = false;
      lastWasObject = true;
    } else {
      unknown.push(tok);
      lastWasObject = false;
    }
  }
  return { picks, unknown };
}

export interface Reason {
  objectId: string;
  meaning: string;
  word: string;
}

export interface MetaphorResult {
  picks: Pick[];
  reasons: Reason[];
  fallback: boolean;
}

export const DEFAULT_SET = ["book", "lamp", "headphones"];

// Scenario 1: every object has a dictionary of meanings keyed by word stems.
// Objects named directly win; then objects with most matched meanings.
export function pickForMetaphor(text: string, maxMain = 3, maxBg = 2): MetaphorResult {
  const score = new Map<string, number>();
  const reasons: Reason[] = [];
  for (const tok of tokens(text)) {
    const direct = matchObjectWord(tok);
    if (direct) {
      score.set(direct, (score.get(direct) ?? 0) + 3);
      reasons.push({ objectId: direct, meaning: "названо прямо", word: tok });
      continue;
    }
    for (const id of OBJECT_IDS) {
      for (const [stemKey, meaning] of Object.entries(META[id].meanings)) {
        if (tok.startsWith(stemKey) && (stemKey.length >= 4 || tok.length <= stemKey.length + 3)) {
          score.set(id, (score.get(id) ?? 0) + 1);
          reasons.push({ objectId: id, meaning, word: tok });
          break;
        }
      }
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || OBJECT_IDS.indexOf(a[0]) - OBJECT_IDS.indexOf(b[0]));
  if (ranked.length === 0) {
    return { picks: DEFAULT_SET.map((objectId) => ({ objectId, variant: "main" })), reasons: [], fallback: true };
  }
  const main = ranked.slice(0, maxMain).map(([id]) => id);
  // Weaker matches become monochrome background objects, as on the reference compositions.
  const bg = ranked.slice(maxMain, maxMain + maxBg).map(([id]) => id);
  // A single match looks empty; add a neutral companion in the background.
  if (main.length === 1 && bg.length === 0) bg.push(main[0] === "book" ? "lamp" : "book");
  const used = new Set([...main, ...bg]);
  return {
    picks: [
      ...main.map((objectId) => ({ objectId, variant: "main" as const })),
      ...bg.map((objectId) => ({ objectId, variant: "bg" as const })),
    ],
    reasons: reasons.filter((r) => used.has(r.objectId)),
    fallback: false,
  };
}

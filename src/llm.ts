// Scenario 1 with a language model. The model may only choose among the library ids and
// answers in a fixed JSON schema; everything it returns is checked again here.
// The page loads this module on demand, so the SDK is fetched only when a key is entered.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { META, OBJECT_IDS } from "./library";
import type { MetaphorResult, Reason } from "./match";

export const LLM_MODEL = "claude-opus-5-5";

const ObjectId = z.enum(OBJECT_IDS as [string, ...string[]]);

export const ChoiceSchema = z.object({
  main: z.array(ObjectId),
  background: z.array(ObjectId),
  reasons: z.array(z.object({ object: ObjectId, reason: z.string() })),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export class LlmError extends Error {}

function catalog(): string {
  return OBJECT_IDS.map((id) => {
    const meanings = [...new Set(Object.values(META[id].meanings))].slice(0, 12);
    return `- ${id} (${META[id].name}): ${meanings.join(", ")}`;
  }).join("\n");
}

export const SYSTEM_PROMPT = `Ты подбираешь объекты для иллюстрации к заголовку или метафоре. Иллюстрация собирается только из объектов каталога, новых объектов не бывает.

Каталог (id, название, примеры смыслов):
${catalog()}

Выбери от 1 до 3 главных объектов, которые лучше всего передают смысл фразы, и от 0 до 2 фоновых, которые дополняют сцену. Один объект не может быть и главным, и фоновым. Смыслы в каталоге только примеры: опирайся на смысл всей фразы, а не на отдельные слова. Если фраза ни с чем в каталоге не связана, выбери нейтральный рабочий набор.

Для каждого выбранного объекта дай причину по-русски, не длиннее восьми слов.`;

const MAX_TEXT = 300;
const MAX_REASON = 80;

// Normalizes the model's choice to the same shape the dictionary returns.
export function choiceToResult(choice: Choice, maxMain = 3, maxBg = 2): MetaphorResult {
  const main = [...new Set(choice.main)].slice(0, maxMain);
  if (main.length === 0) throw new LlmError("модель не выбрала ни одного объекта");
  const bg = [...new Set(choice.background)].filter((id) => !main.includes(id)).slice(0, maxBg);
  const used = new Set([...main, ...bg]);
  const reasons: Reason[] = [];
  for (const r of choice.reasons) {
    const text = r.reason.trim();
    if (!used.has(r.object) || !text || reasons.some((x) => x.objectId === r.object)) continue;
    reasons.push({ objectId: r.object, meaning: text.slice(0, MAX_REASON), word: "" });
  }
  return {
    picks: [
      ...main.map((objectId) => ({ objectId, variant: "main" as const })),
      ...bg.map((objectId) => ({ objectId, variant: "bg" as const })),
    ],
    reasons,
    fallback: false,
  };
}

export function createClient(apiKey: string): Anthropic {
  // The key belongs to the person using the page and goes straight to the API from their browser.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60_000 });
}

export async function pickWithLLM(text: string, client: Pick<Anthropic, "messages">): Promise<MetaphorResult> {
  const input = text.trim().slice(0, MAX_TEXT);
  if (!input) throw new LlmError("пустой заголовок");
  const response = await client.messages.parse({
    model: LLM_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: input }],
    output_config: { effort: "low", format: zodOutputFormat(ChoiceSchema) },
  });
  if (response.stop_reason === "refusal") throw new LlmError("модель отказалась отвечать");
  if (response.stop_reason === "max_tokens") throw new LlmError("ответ модели оборвался");
  if (!response.parsed_output) throw new LlmError("ответ модели не разобран");
  return choiceToResult(response.parsed_output);
}

// Most specific first: every API error class extends APIError.
export function describeError(err: unknown): string {
  if (err instanceof LlmError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "ключ API не подошел";
  if (err instanceof Anthropic.PermissionDeniedError) return "у ключа нет доступа к модели";
  if (err instanceof Anthropic.RateLimitError) return "слишком много запросов, попробуйте позже";
  if (err instanceof Anthropic.APIConnectionError) return "нет соединения с API";
  if (err instanceof Anthropic.APIError) return `ошибка API ${err.status ?? ""}`.trim();
  return "неожиданная ошибка";
}

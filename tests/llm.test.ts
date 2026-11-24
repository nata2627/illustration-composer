import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { OBJECT_IDS } from "../src/library";
import { choiceToResult, describeError, LLM_MODEL, LlmError, pickWithLLM, SYSTEM_PROMPT, type Choice } from "../src/llm";

// A stand-in for the SDK client: records the request and returns a prepared response.
function fakeClient(response: { stop_reason: string; parsed_output: Choice | null }) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        return response;
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, "messages">, calls };
}

const choice = (c: Partial<Choice>): Choice => ({ main: [], background: [], reasons: [], ...c });

describe("choiceToResult", () => {
  it("keeps up to three main and two background objects without repeats", () => {
    const r = choiceToResult(
      choice({
        main: ["lamp", "lamp", "book", "pen", "coin"],
        background: ["book", "vase", "vase", "folder", "phone"],
        reasons: [
          { object: "lamp", reason: " идея " },
          { object: "lamp", reason: "свет" },
          { object: "coin", reason: "отброшена" },
        ],
      }),
    );
    expect(r.picks).toEqual([
      { objectId: "lamp", variant: "main" },
      { objectId: "book", variant: "main" },
      { objectId: "pen", variant: "main" },
      { objectId: "vase", variant: "bg" },
      { objectId: "folder", variant: "bg" },
    ]);
    expect(r.reasons).toEqual([{ objectId: "lamp", meaning: "идея", word: "" }]);
    expect(r.fallback).toBe(false);
  });

  it("refuses an empty choice", () => {
    expect(() => choiceToResult(choice({ background: ["book"] }))).toThrow(LlmError);
  });
});

describe("pickWithLLM", () => {
  it("asks for the library ids only and returns the checked choice", async () => {
    const { client, calls } = fakeClient({
      stop_reason: "end_turn",
      parsed_output: choice({ main: ["headphones", "coin"], background: ["wallet"], reasons: [{ object: "coin", reason: "личные финансы" }] }),
    });
    const r = await pickWithLLM("  Подкаст о личных финансах  ", client);
    expect(r.picks.map((p) => p.objectId)).toEqual(["headphones", "coin", "wallet"]);

    const req = calls[0] as { model: string; system: string; messages: { content: string }[]; output_config: { effort: string; format: unknown } };
    expect(req.model).toBe(LLM_MODEL);
    expect(req.messages[0].content).toBe("Подкаст о личных финансах");
    expect(req.output_config.effort).toBe("low");
    expect(req.output_config.format).toBeTruthy();
    for (const id of OBJECT_IDS) expect(SYSTEM_PROMPT).toContain(`- ${id} (`);
  });

  it.each([
    ["refusal", choice({ main: ["lamp"] }), /отказалась/],
    ["max_tokens", null, /оборвался/],
    ["end_turn", null, /не разобран/],
  ] as const)("turns stop_reason %s into a readable error", async (stop_reason, parsed_output, message) => {
    const { client } = fakeClient({ stop_reason, parsed_output });
    await expect(pickWithLLM("Идея", client)).rejects.toThrow(message);
  });

  it("does not call the API for an empty headline", async () => {
    const { client, calls } = fakeClient({ stop_reason: "end_turn", parsed_output: null });
    await expect(pickWithLLM("   ", client)).rejects.toThrow(LlmError);
    expect(calls).toHaveLength(0);
  });
});

describe("describeError", () => {
  it("names the usual API failures", () => {
    expect(describeError(new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()))).toBe("ключ API не подошел");
    expect(describeError(new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()))).toMatch(/слишком много/);
    expect(describeError(new Anthropic.APIConnectionError({ message: "fetch failed" }))).toBe("нет соединения с API");
    expect(describeError(new Anthropic.InternalServerError(500, undefined, "boom", new Headers()))).toBe("ошибка API 500");
    expect(describeError(new LlmError("пустой заголовок"))).toBe("пустой заголовок");
    expect(describeError(new TypeError("x"))).toBe("неожиданная ошибка");
  });
});

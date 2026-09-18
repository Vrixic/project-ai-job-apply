import type { ModelIdentity, ModelProvider, ProviderRequest } from "./gateway.js";

const FAKE_IDENTITY: ModelIdentity = {
  provider: "offline-fake",
  model: "scripted",
  version: "0.0.0",
};

/** Returns exactly the scripted output. Used to feed hostile or malformed model output to the checks. */
export class ScriptedProvider implements ModelProvider {
  readonly identity = FAKE_IDENTITY;
  readonly calls: ProviderRequest[] = [];

  constructor(private readonly output: string | (() => Promise<string>)) {}

  async complete(request: ProviderRequest): Promise<{ text: string }> {
    this.calls.push(request);
    return { text: typeof this.output === "string" ? this.output : await this.output() };
  }
}

/**
 * Deterministic honest "model": one paragraph per fact group that cites and restates only fact
 * values. It never contacts a network and makes no quality claim about a real model.
 */
export class TemplateProvider implements ModelProvider {
  readonly identity: ModelIdentity = { ...FAKE_IDENTITY, model: "template" };

  async complete(request: ProviderRequest): Promise<{ text: string }> {
    const match = /FACTS:\n(\[.*\])\n/u.exec(request.user);
    const facts = JSON.parse(match?.[1] ?? "[]") as Array<{
      id: string;
      kind: string;
      key: string;
      value: string;
    }>;
    const paragraphs = facts.slice(0, 2).map((fact) => ({
      text: `I have experience with ${fact.value}.`,
      factIds: [fact.id],
    }));
    return { text: JSON.stringify({ paragraphs }) };
  }
}

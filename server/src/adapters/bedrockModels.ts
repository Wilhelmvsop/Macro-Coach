import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { log } from "../logger.js";

/** Errors that mean "this model is not usable from this account", as opposed to a bad request. */
const MODEL_UNAVAILABLE = new Set(["AccessDeniedException", "ResourceNotFoundException"]);

/**
 * Calls Bedrock Converse with an ordered list of model IDs. If a model is not
 * enabled for the account (for example Anthropic models before the use-case form
 * is approved), it moves to the next one and remembers the choice.
 */
export class BedrockModelChain {
  private readonly client: BedrockRuntimeClient;
  private index = 0;

  constructor(readonly modelIds: string[], region: string) {
    if (modelIds.length === 0) throw new Error("At least one Bedrock model ID is required");
    this.client = new BedrockRuntimeClient({ region });
  }

  get currentModel(): string {
    return this.modelIds[this.index]!;
  }

  async converse(input: Omit<ConverseCommandInput, "modelId">): Promise<ConverseCommandOutput & { modelId: string }> {
    for (let i = this.index; i < this.modelIds.length; i++) {
      const modelId = this.modelIds[i]!;
      try {
        const out = await this.client.send(new ConverseCommand({ ...input, modelId }));
        if (i !== this.index) {
          log.warn("bedrock.model.switched", { from: this.modelIds[this.index], to: modelId });
          this.index = i;
        }
        return { ...out, modelId };
      } catch (err) {
        const name = (err as { name?: string }).name ?? "";
        if (!MODEL_UNAVAILABLE.has(name) || i === this.modelIds.length - 1) throw err;
        log.warn("bedrock.model.unavailable", { modelId, error: name });
      }
    }
    throw new Error("unreachable");
  }
}

export function parseModelIds(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

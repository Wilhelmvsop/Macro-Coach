import { BedrockRuntimeClient, ConverseCommand, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

/**
 * System prompt for the simulator's voice assistant. Kept server-side so the
 * public endpoint cannot be repurposed as a general chatbot.
 */
export const AGENT_SYSTEM =
  "You are the voice assistant in a smart speaker demo, connected to the Macro Coach nutrition tools. " +
  "For anything about food, meals, calories, macros, goals or progress, call the matching tool. " +
  "When a tool returns text, reply with that text, lightly adapted for speech; never invent nutrition numbers. " +
  "If a tool result asks a question, ask it. Keep replies to one or two short sentences with no markdown, lists or emojis. " +
  "Politely decline requests unrelated to nutrition and fitness.";

const ToolSchema = z.object({
  name: z.string().regex(/^[a-z_]{1,64}$/),
  description: z.string().max(2000),
  inputSchema: z.record(z.string(), z.unknown()),
});

export const AgentLlmRequest = z.object({
  /** Bedrock Converse messages; validated loosely here and strictly by Bedrock. */
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.array(z.record(z.string(), z.unknown())) })).min(1).max(40),
  tools: z.array(ToolSchema).max(20),
});

export interface AgentLlm {
  converse(req: z.infer<typeof AgentLlmRequest>): Promise<{ message: Message; stopReason: string }>;
}

/** One Bedrock Converse turn for the simulator's agent loop. */
export class BedrockAgentLlm implements AgentLlm {
  private readonly client: BedrockRuntimeClient;
  constructor(private readonly modelId: string, region: string) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async converse(req: z.infer<typeof AgentLlmRequest>) {
    const tools: Tool[] = req.tools.map((t) => ({
      toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as Record<string, never> } },
    }));
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: AGENT_SYSTEM }],
        messages: req.messages as unknown as Message[],
        ...(tools.length > 0 ? { toolConfig: { tools, toolChoice: { auto: {} } } } : {}),
        inferenceConfig: { maxTokens: 2000 },
      }),
    );
    const message = res.output?.message ?? { role: "assistant", content: [{ text: "Sorry, I didn't get that." }] };
    return { message, stopReason: res.stopReason ?? "end_turn" };
  }
}

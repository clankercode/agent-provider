import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type { AgentProviderBridge } from "./bridge.js";

export class AgentProviderLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "agent-provider";
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    private readonly bridge: AgentProviderBridge,
    readonly modelId: string,
  ) {}

  doGenerate(
    options: LanguageModelV4CallOptions,
  ): PromiseLike<LanguageModelV4GenerateResult> {
    return this.bridge.generate(this.modelId, options);
  }

  doStream(
    options: LanguageModelV4CallOptions,
  ): PromiseLike<LanguageModelV4StreamResult> {
    return this.bridge.stream(this.modelId, options);
  }
}

import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
} from "@ai-sdk/provider";

/**
 * Removes values that must never be controlled by page code at the network
 * boundary. The extension repeats and strengthens these checks.
 */
export function sanitizeLanguageModelCallOptions(
  options: LanguageModelV4CallOptions,
): Omit<LanguageModelV4CallOptions, "abortSignal" | "headers"> {
  const tools = options.tools
    ?.filter(
      (candidate): candidate is LanguageModelV4FunctionTool =>
        candidate.type === "function",
    )
    .map(({ providerOptions: _providerOptions, ...candidate }) => candidate);

  return {
    prompt: options.prompt,
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.stopSequences === undefined
      ? {}
      : { stopSequences: options.stopSequences }),
    ...(options.topP === undefined ? {} : { topP: options.topP }),
    ...(options.topK === undefined ? {} : { topK: options.topK }),
    ...(options.presencePenalty === undefined
      ? {}
      : { presencePenalty: options.presencePenalty }),
    ...(options.frequencyPenalty === undefined
      ? {}
      : { frequencyPenalty: options.frequencyPenalty }),
    ...(options.responseFormat === undefined
      ? {}
      : { responseFormat: options.responseFormat }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(tools === undefined ? {} : { tools }),
    ...(options.toolChoice === undefined
      ? {}
      : { toolChoice: options.toolChoice }),
    includeRawChunks: false,
    ...(options.reasoning === undefined
      ? {}
      : { reasoning: options.reasoning }),
  };
}

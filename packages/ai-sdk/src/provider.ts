import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import {
  AgentProviderBridge,
  type AgentProviderBridgeOptions,
} from "./bridge.js";
import { AgentProviderLanguageModel } from "./model.js";

export interface AgentProviderProvider {
  (alias?: string): LanguageModelV4;
  languageModel(alias?: string): LanguageModelV4;
  readonly bridge: AgentProviderBridge;
}

export interface CreateAgentProviderProviderOptions extends AgentProviderBridgeOptions {
  bridge?: AgentProviderBridge;
  defaultAlias?: string;
}

export function createAgentProviderProvider(
  options: CreateAgentProviderProviderOptions = {},
): AgentProviderProvider {
  const bridge = options.bridge ?? new AgentProviderBridge(options);
  const defaultAlias = options.defaultAlias ?? "default";
  const createModel = (alias = defaultAlias): LanguageModelV4 =>
    new AgentProviderLanguageModel(bridge, alias);

  return Object.assign(createModel, {
    languageModel: createModel,
    bridge,
  });
}

export interface CreateAgentProviderModelOptions extends AgentProviderBridgeOptions {
  alias?: string;
  bridge?: AgentProviderBridge;
}

/** Stable advanced escape hatch for custom AI SDK loops. */
export function createAgentProviderModel(
  options: CreateAgentProviderModelOptions = {},
): LanguageModel {
  const { alias = "default", ...providerOptions } = options;
  return createAgentProviderProvider(providerOptions)(alias) as LanguageModel;
}

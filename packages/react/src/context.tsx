import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import type {
  AgentProviderRuntime,
  AgentProviderRuntimeState,
} from "@agent-provider/runtime";

const RuntimeContext = createContext<AgentProviderRuntime | null>(null);

export interface AgentProviderProviderProps extends PropsWithChildren {
  runtime: AgentProviderRuntime;
  destroyOnUnmount?: boolean;
}

export function AgentProviderProvider({
  runtime,
  destroyOnUnmount = false,
  children,
}: AgentProviderProviderProps) {
  const generation = useRef(0);
  const latestRuntime = useRef(runtime);
  latestRuntime.current = runtime;

  useEffect(() => {
    const mountedGeneration = ++generation.current;
    return () => {
      if (!destroyOnUnmount) return;
      queueMicrotask(() => {
        if (
          latestRuntime.current !== runtime ||
          generation.current === mountedGeneration
        ) {
          runtime.destroy();
        }
      });
    };
  }, [destroyOnUnmount, runtime]);

  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useAgentProviderRuntime(): AgentProviderRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error(
      "useAgentProviderRuntime must be used inside AgentProviderProvider.",
    );
  }
  return runtime;
}

export function useAgentProviderState(): AgentProviderRuntimeState {
  const runtime = useAgentProviderRuntime();
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
}

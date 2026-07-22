import { createAgentProviderId } from "./id.js";
import type { ApprovalRequest } from "./types.js";

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly timeoutMs: number,
    private readonly onChange: (requests: ApprovalRequest[]) => void,
  ) {}

  request(
    input: Omit<ApprovalRequest, "id" | "requestedAt">,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted === true) {
      return Promise.resolve(false);
    }

    const request: ApprovalRequest = {
      ...input,
      id: createAgentProviderId("approval"),
      requestedAt: Date.now(),
    };

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => this.resolve(request.id, false),
        this.timeoutMs,
      );
      const pending: PendingApproval = { request, resolve, timer };

      if (signal !== undefined) {
        const onAbort = () => this.resolve(request.id, false);
        signal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      }

      this.pending.set(request.id, pending);
      this.emit();
    });
  }

  resolve(id: string, approved: boolean): boolean {
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return false;
    }

    clearTimeout(pending.timer);
    pending.removeAbortListener?.();
    this.pending.delete(id);
    pending.resolve(approved);
    this.emit();
    return true;
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.resolve(id, false);
    }
  }

  snapshot(): ApprovalRequest[] {
    return [...this.pending.values()].map(({ request }) => request);
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}

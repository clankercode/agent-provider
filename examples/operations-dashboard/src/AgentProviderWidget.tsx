import {
  useMemo,
  type ButtonHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { instantChatbot } from "@agent-provider/runtime";
import { createPageContext } from "@agent-provider/context";
import {
  AgentProviderLauncher,
  AgentProviderProvider,
  type AgentProviderChatComponents,
} from "@agent-provider/react";
import { z } from "zod";
import { dashboardStore } from "./store.js";

function AppButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} data-ui="button" />;
}

function AppTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} data-ui="textarea" />;
}

const components: AgentProviderChatComponents = {
  Button: AppButton,
  Textarea: AppTextarea,
};

export default function AgentProviderWidget() {
  const context = useMemo(
    () =>
      createPageContext({
        roots: () =>
          document.querySelector<HTMLElement>("[data-agent-provider-root]"),
        regions: {
          orders: () =>
            document.querySelector<HTMLElement>(
              "[data-agent-provider-region='orders']",
            ),
          "billing-form": () =>
            document.querySelector<HTMLElement>(
              "[data-agent-provider-region='billing-form']",
            ),
        },
      }),
    [],
  );
  const runtime = useMemo(
    () =>
      instantChatbot({
        appName: "Northstar Admin",
        modelAlias: "default",
        instructions: `You are the copilot for an internal account dashboard.
Use tools instead of inventing account or order data. Read tools are safe.
Before changing account state or issuing a refund, explain what will happen;
the runtime will obtain explicit user approval.`,
        suggestions: [
          "Summarize this account",
          "Which orders are still paid but not shipped?",
          "Put this account into review",
        ],
        maxSteps: 10,
        context,
        initialContext: "snapshot",
        contextRefresh: "before-user-turn",
        tools: {
          get_account_summary: {
            description: "Return the currently displayed account summary.",
            inputSchema: z.object({}),
            risk: "read",
            execute: () => dashboardStore.getSnapshot(),
          },
          search_orders: {
            description:
              "Search orders by status. Omit status to return every visible order.",
            inputSchema: z.object({
              status: z.enum(["paid", "shipped", "refunded"]).optional(),
            }),
            risk: "read",
            execute: ({ status }) => {
              const orders = dashboardStore.getSnapshot().orders;
              return status === undefined
                ? orders
                : orders.filter((order) => order.status === status);
            },
          },
          set_account_status: {
            description:
              "Change the account status shown in this dashboard and persist it through the page application.",
            inputSchema: z.object({
              status: z.enum(["active", "review", "paused"]),
              reason: z.string().min(3).max(200),
            }),
            risk: "write",
            approvalLabel: ({ status }) =>
              `Change account status to ${status}?`,
            execute: ({ status, reason }) => ({
              account: dashboardStore.setStatus(status),
              auditMessage: reason,
            }),
          },
          refund_order: {
            description:
              "Refund one order by exact order ID. This is a destructive financial action.",
            inputSchema: z.object({
              orderId: z.string().regex(/^ORD-\d+$/),
              reason: z.string().min(3).max(200),
            }),
            risk: "destructive",
            confirmation: "always",
            approvalLabel: ({ orderId }) => `Issue a refund for ${orderId}?`,
            execute: ({ orderId, reason }) => ({
              order: dashboardStore.refundOrder(orderId),
              auditMessage: reason,
            }),
          },
        },
      }),
    [context],
  );

  return (
    <AgentProviderProvider runtime={runtime} destroyOnUnmount>
      <AgentProviderLauncher
        title="Northstar copilot"
        buttonLabel="Ask this page"
        components={components}
        defaultOpen
      />
    </AgentProviderProvider>
  );
}

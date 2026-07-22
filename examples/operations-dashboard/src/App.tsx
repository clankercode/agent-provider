import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { dashboardStore } from "./store.js";

const AgentProviderWidget = lazy(() => import("./AgentProviderWidget.js"));

export function App() {
  const dashboard = useSyncExternalStore(
    dashboardStore.subscribe,
    dashboardStore.getSnapshot,
  );
  const [agentProviderLoaded, setAgentProviderLoaded] = useState(false);

  return (
    <>
      <main className="dashboard-shell" data-agent-provider-root>
        <header className="topbar">
          <div>
            <span className="eyebrow">Account workspace</span>
            <h1>{dashboard.accountName}</h1>
          </div>
          <span
            className={`account-status account-status--${dashboard.accountStatus}`}
          >
            {dashboard.accountStatus}
          </span>
        </header>

        <section className="metrics">
          <article>
            <span>Plan</span>
            <strong>{dashboard.plan}</strong>
          </article>
          <article>
            <span>Monthly spend</span>
            <strong>${dashboard.monthlySpend.toLocaleString()}</strong>
          </article>
          <article>
            <span>Orders</span>
            <strong>{dashboard.orders.length}</strong>
          </article>
        </section>

        <section
          className="billing-card"
          data-agent-provider-region="billing-form"
        >
          <div className="card-heading">
            <div>
              <span className="eyebrow">Form context</span>
              <h2>Billing contact</h2>
            </div>
            <small>
              Safe form fields are included in bounded page context.
            </small>
          </div>
          <form className="billing-form">
            <label>
              Contact name
              <input name="contactName" defaultValue="Rina Patel" />
            </label>
            <label>
              Renewal note
              <input
                name="renewalNote"
                defaultValue="Confirm annual pricing before 31 July"
              />
            </label>
            <label>
              Private token
              <input
                name="privateToken"
                type="password"
                defaultValue="not-exposed"
              />
            </label>
            <button type="button">Save contact</button>
          </form>
        </section>

        <section className="orders-card" data-agent-provider-region="orders">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Live page data</span>
              <h2>Recent orders</h2>
            </div>
            <small>Tools call the same page functions as this UI.</small>
          </div>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.customer}</td>
                  <td>${order.total.toLocaleString()}</td>
                  <td>{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      {agentProviderLoaded ? (
        <Suspense
          fallback={
            <button
              type="button"
              className="agent-provider-launcher__button agent-provider-demo-loader"
              disabled
            >
              Loading copilot…
            </button>
          }
        >
          <AgentProviderWidget />
        </Suspense>
      ) : (
        <button
          type="button"
          className="agent-provider-launcher__button agent-provider-demo-loader"
          onClick={() => setAgentProviderLoaded(true)}
        >
          Ask this page
        </button>
      )}
    </>
  );
}

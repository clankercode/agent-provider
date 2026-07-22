export interface Order {
  id: string;
  customer: string;
  total: number;
  status: "paid" | "shipped" | "refunded";
}

export interface DashboardData {
  accountName: string;
  accountStatus: "active" | "review" | "paused";
  plan: string;
  monthlySpend: number;
  orders: Order[];
}

let data: DashboardData = {
  accountName: "Northstar Logistics",
  accountStatus: "active",
  plan: "Enterprise",
  monthlySpend: 18_420,
  orders: [
    { id: "ORD-1042", customer: "Northstar", total: 1_890, status: "paid" },
    { id: "ORD-1038", customer: "Northstar", total: 4_220, status: "shipped" },
    { id: "ORD-1021", customer: "Northstar", total: 760, status: "paid" },
  ],
};

const listeners = new Set<() => void>();

export const dashboardStore = {
  getSnapshot: () => data,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setStatus(status: DashboardData["accountStatus"]) {
    data = { ...data, accountStatus: status };
    for (const listener of listeners) listener();
    return data;
  },
  refundOrder(orderId: string) {
    const order = data.orders.find((candidate) => candidate.id === orderId);
    if (order === undefined) throw new Error(`Order ${orderId} was not found.`);
    if (order.status === "refunded") return order;
    const refunded: Order = { ...order, status: "refunded" };
    data = {
      ...data,
      orders: data.orders.map((candidate) =>
        candidate.id === orderId ? refunded : candidate,
      ),
    };
    for (const listener of listeners) listener();
    return refunded;
  },
};

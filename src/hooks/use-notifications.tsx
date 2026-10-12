import { useQuery } from "@tanstack/react-query";
import { fetchPendingOrders, fetchProducts } from "@/lib/data";
import { formatCurrency } from "@/lib/format";

export type AppNotification = { id: string; title: string; description: string };

export function useNotifications(): AppNotification[] {
  const { data: pendingResult } = useQuery({
    queryKey: ["orders", "pending-preview"],
    queryFn: () => fetchPendingOrders(4),
    refetchInterval: 60000,
  });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });

  const pending = pendingResult?.rows ?? [];
  const pendingTotal = pendingResult?.total ?? 0;
  const low = products.filter((p) => p.stock <= p.low_stock_threshold).slice(0, 4);

  return [
    ...(pendingTotal > pending.length
      ? [
          {
            id: "orders-pending-summary",
            title: `${pendingTotal.toLocaleString("en-IN")} orders pending`,
            description: "Open Orders and filter by Pending to process them",
          },
        ]
      : []),
    ...pending.map((o) => ({
      id: `order-${o.id}`,
      title: `New ${o.source === "whatsapp" ? "WhatsApp" : o.source} order ${o.order_number}`,
      description: `${o.customer_name} · ${formatCurrency(o.total)}`,
    })),
    ...low.map((p) => ({
      id: `stock-${p.id}`,
      title: `Low stock: ${p.name}`,
      description: `${p.stock} left · SKU ${p.sku}`,
    })),
  ];
}

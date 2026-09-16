import { useQuery } from "@tanstack/react-query";
import { fetchOrders, fetchProducts } from "@/lib/data";
import { formatCurrency } from "@/lib/format";

export type AppNotification = { id: string; title: string; description: string };

export function useNotifications(): AppNotification[] {
  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    refetchInterval: 60000,
  });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });

  const pending = orders.filter((o) => o.status === "pending").slice(0, 4);
  const low = products.filter((p) => p.stock <= p.low_stock_threshold).slice(0, 4);

  return [
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

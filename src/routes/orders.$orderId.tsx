import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Clock, User } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/export-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchOrder, updateOrderStatus, fetchOrderStatusHistory, fetchOrderAssignmentHistory, fetchEmployees, recordStatusChange, recordAssignmentChange, type OrderStatusHistory, type OrderAssignmentHistory, type Employee } from "@/lib/data";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useRole } from "@/components/role-provider";

const FLOW = ["pending", "processing", "shipped", "completed", "cancelled"];

export const Route = createFileRoute("/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Order details — ibird" },
      {
        name: "description",
        content:
          "Full ibird order detail: customer info, line items, pricing breakdown, payment status, refunds and printable receipt.",
      },
      { property: "og:title", content: "Order details — ibird" },
      {
        property: "og:description",
        content: "Review items, pricing and payment, advance the status or issue a refund.",
      },
    ],
  }),
  component: OrderDetail,
});

function OrderDetail() {
  const { orderId } = useParams({ from: "/orders/$orderId" });
  const queryClient = useQueryClient();
  const { can, user } = useRole();
  const { data, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => fetchOrder(orderId),
  });
  const { data: statusHistory = [] } = useQuery({
    queryKey: ["order-status-history", orderId],
    queryFn: () => fetchOrderStatusHistory(orderId),
  });
  const { data: assignmentHistory = [] } = useQuery({
    queryKey: ["order-assignment-history", orderId],
    queryFn: () => fetchOrderAssignmentHistory(orderId),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
  });

  const mutate = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const oldStatus = data?.order.status;
      await updateOrderStatus([orderId], patch);

      // Record status change if status was updated
      if (patch.status && patch.status !== oldStatus) {
        await recordStatusChange(orderId, oldStatus || null, patch.status as string, user?.id || null);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order-status-history", orderId] });
      toast.success("Order updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <AppShell title="Order" subtitle="Loading order…">
        <div className="card-surface p-8 text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  const { order, items } = data;

  return (
    <AppShell
      title={order.order_number}
      subtitle={`Placed ${formatDateTime(order.created_at)} · ${order.source}`}
      actions={
        <>
          <Button variant="outline" asChild className="gap-2">
            <Link to="/orders">
              <ArrowLeft className="size-4" /> Back
            </Link>
          </Button>
          <ExportMenu
            filename={`receipt-${order.order_number}`}
            title={`Receipt ${order.order_number}`}
            rows={items.map((i) => ({
              Item: i.product_name,
              SKU: i.sku ?? "",
              Qty: i.quantity,
              Price: Number(i.unit_price),
              Total: Number(i.line_total),
            }))}
          />
          <Button className="gap-2" onClick={() => window.print()}>
            <Printer className="size-4" /> Print receipt
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold">Items</h2>
          <div className="mt-4 divide-y divide-border">
            {items.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{i.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    SKU {i.sku} · {i.quantity} × {formatCurrency(i.unit_price)}
                  </p>
                </div>
                <p className="font-semibold">{formatCurrency(i.line_total)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <Row label="Subtotal" value={formatCurrency(order.subtotal)} />
            <Row label="Discount" value={`- ${formatCurrency(order.discount)}`} />
            <Row label="Tax (5%)" value={formatCurrency(order.tax)} />
            {Number(order.refund_amount) > 0 && (
              <Row label="Refunded" value={`- ${formatCurrency(order.refund_amount)}`} />
            )}
            <div className="flex items-center justify-between border-t border-border pt-3 text-base font-bold">
              <span>Total</span>
              <span>{formatCurrency(order.total)}</span>
            </div>
          </div>
          </div>

          {/* Assignment History */}
          {assignmentHistory.length > 0 && (
            <div className="card-surface p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="size-5" />
                <h2 className="text-lg font-bold">Assignment History</h2>
              </div>
              <div className="space-y-3">
                {assignmentHistory.map((entry) => (
                  <div key={entry.id} className="border-l-2 border-blue-500 pl-4 py-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-sm">
                          {entry.old_assigned_to && entry.new_assigned_to ? "Re-assigned to" : entry.new_assigned_to ? "Assigned to" : "Unassigned"}
                        </p>
                        {entry.new_assigned_to && (
                          <p className="text-sm font-medium mt-1">
                            {employees.find((e) => e.id === entry.new_assigned_to)?.name || "Unknown"}
                          </p>
                        )}
                        {entry.old_assigned_to && (
                          <p className="text-xs text-muted-foreground">
                            from {employees.find((e) => e.id === entry.old_assigned_to)?.name || "Unassigned"}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <Clock className="size-3" />
                          {new Date(entry.assigned_at).toLocaleString()}
                        </p>
                        {entry.assigned_by && (
                          <p className="text-xs text-muted-foreground mt-1">
                            by {employees.find((e) => e.id === entry.assigned_by)?.name || "System"}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status History */}
          {statusHistory.length > 0 && (
            <div className="card-surface p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="size-5" />
                <h2 className="text-lg font-bold">Status History</h2>
              </div>
              <div className="space-y-3">
                {statusHistory.map((entry) => (
                  <div key={entry.id} className="border-l-2 border-amber-500 pl-4 py-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          {entry.old_status && <StatusBadge value={entry.old_status} />}
                          <span className="text-muted-foreground">→</span>
                          <StatusBadge value={entry.new_status} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <Clock className="size-3" />
                          {new Date(entry.changed_at).toLocaleString()}
                        </p>
                        {entry.changed_by && (
                          <p className="text-xs text-muted-foreground mt-1">
                            by {employees.find((e) => e.id === entry.changed_by)?.name || "System"}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold">Customer details</h2>
            <p className="mt-2 font-semibold">{order.customer_name}</p>
            <p className="text-sm text-muted-foreground">Channel: {order.source}</p>

            {order.customer_phone && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Phone</p>
                <p className="mt-1 text-sm">{order.customer_phone}</p>
              </div>
            )}

            {order.delivery_address && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Delivery address</p>
                <p className="mt-1 text-sm">{order.delivery_address}</p>
              </div>
            )}

            {order.special_instructions && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Special instructions</p>
                <p className="mt-1 text-sm">{order.special_instructions}</p>
              </div>
            )}

            {order.notes && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Order notes</p>
                <p className="mt-1 text-sm">{order.notes}</p>
              </div>
            )}
          </div>

          <div className="card-surface space-y-3 p-5">
            <h2 className="text-lg font-bold">Status</h2>
            <div className="flex flex-wrap gap-2">
              <StatusBadge value={order.status} />
              <StatusBadge value={order.payment_status} />
              <StatusBadge value={order.payment_method} />
            </div>
            {can("edit") && (
              <>
                <Select
                  value={order.status}
                  onValueChange={(v) =>
                    mutate.mutate({
                      status: v,
                      payment_status: v === "completed" ? "paid" : order.payment_status,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FLOW.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={order.payment_method}
                  onValueChange={(v) => mutate.mutate({ payment_method: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    mutate.mutate({
                      status: "cancelled",
                      payment_status: "refunded",
                      refund_amount: order.total,
                    })
                  }
                >
                  Cancel & refund
                </Button>
              </>
            )}
          </div>

          {/* Current Assignment Info */}
          {(can("admin") || can("manageStaff")) && (
            <div className="card-surface p-5">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <User className="size-5" />
                Assignment
              </h2>
              {order.assigned_to ? (
                <div>
                  <p className="text-sm text-muted-foreground">Currently assigned to</p>
                  <p className="mt-1 font-semibold">{employees.find((e) => e.id === order.assigned_to)?.name || "Unknown"}</p>
                  {order.assigned_at && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Assigned on {new Date(order.assigned_at).toLocaleString()}
                    </p>
                  )}
                  {order.assigned_by && (
                    <p className="text-xs text-muted-foreground">
                      by {employees.find((e) => e.id === order.assigned_by)?.name || "System"}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Not assigned to anyone</p>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

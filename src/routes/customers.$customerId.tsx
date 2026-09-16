import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Phone, MapPin, ShoppingBag, DollarSign } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchCustomers, fetchOrders } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";

export const Route = createFileRoute("/customers/$customerId")({
  head: () => ({
    meta: [
      { title: "Customer Details — ibird" },
      { name: "description", content: "Customer profile with order history and statistics." },
    ],
  }),
  component: CustomerDetail,
});

function CustomerDetail() {
  const { customerId } = useParams({ from: "/customers/$customerId" });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: fetchOrders,
  });

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return (
      <AppShell title="Customer" subtitle="Not found">
        <div className="card-surface p-8 text-center text-muted-foreground">Customer not found</div>
      </AppShell>
    );
  }

  const customerOrders = orders
    .filter((o) => o.customer_id === customerId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const totalOrders = customerOrders.length;
  const totalSpent = customerOrders.reduce((sum, o) => sum + Number(o.total), 0);
  const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

  return (
    <AppShell
      title={customer.name}
      subtitle="Profile and order history"
      actions={
        <Button variant="outline" asChild className="gap-2">
          <Link to="/customers">
            <ArrowLeft className="size-4" /> Back
          </Link>
        </Button>
      }
    >
      {/* Customer Info */}
      <div className="card-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-bold mb-4">Information</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Name</p>
                <p className="mt-1 font-semibold">{customer.name}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                  <Phone className="size-3" /> Phone
                </p>
                <p className="mt-1 font-semibold">{customer.phone || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Email</p>
                <p className="mt-1 text-sm">{customer.email || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                  <MapPin className="size-3" /> Location
                </p>
                <p className="mt-1 text-sm">
                  {customer.city || customer.state ? `${customer.city || ""}${customer.state ? `, ${customer.state}` : ""}` : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div>
            <h2 className="text-lg font-bold mb-4">Statistics</h2>
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3 bg-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Total Orders</p>
                    <p className="mt-1 text-2xl font-bold">{totalOrders}</p>
                  </div>
                  <ShoppingBag className="size-5 text-muted-foreground" />
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 bg-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Total Spent</p>
                    <p className="mt-1 text-2xl font-bold">{formatCurrency(totalSpent)}</p>
                  </div>
                  <DollarSign className="size-5 text-success" />
                </div>
              </div>
              <div className="rounded-lg border border-border p-3 bg-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Avg Order</p>
                    <p className="mt-1 text-2xl font-bold">{formatCurrency(avgOrderValue)}</p>
                  </div>
                  <DollarSign className="size-5 text-brand" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Orders */}
      <div className="card-surface mt-5 p-4">
        <h2 className="text-lg font-bold mb-4">Order History</h2>
        {customerOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No orders yet</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-semibold">{order.order_number}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(order.created_at)}</TableCell>
                    <TableCell>
                      <StatusBadge value={order.status} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(order.total)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/orders/$orderId" params={{ orderId: order.id }}>
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Addresses */}
      {customerOrders.some((o) => o.delivery_address) && (
        <div className="card-surface mt-5 p-4">
          <h2 className="text-lg font-bold mb-4">Delivery Addresses</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from(
              new Set(
                customerOrders
                  .filter((o) => o.delivery_address)
                  .map((o) => o.delivery_address)
              )
            ).map((address, idx) => (
              <div key={idx} className="rounded-lg border border-border p-3 bg-card">
                <div className="flex items-start gap-2">
                  <MapPin className="size-4 mt-1 text-muted-foreground flex-shrink-0" />
                  <p className="text-sm">{address}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}

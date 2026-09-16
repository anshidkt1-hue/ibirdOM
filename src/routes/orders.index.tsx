import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ChevronLeft, ChevronRight, User, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ExportMenu } from "@/components/export-menu";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteOrders, fetchOrders, updateOrderStatus, assignOrders, unassignOrders, fetchEmployees, recordStatusChange, recordAssignmentChange, type Employee } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";
import { useRole } from "@/components/role-provider";

const STATUSES = ["pending", "processing", "shipped", "completed", "cancelled"];

export const Route = createFileRoute("/orders/")({
  head: () => ({
    meta: [
      { title: "Orders — ibird Order Management" },
      {
        name: "description",
        content:
          "View, filter and process every ibird order from WhatsApp, walk-in and manual channels with bulk actions and exports.",
      },
      { property: "og:title", content: "Orders — ibird Order Management" },
      {
        property: "og:description",
        content: "Filter by date, status, customer and channel, then process orders in bulk.",
      },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const queryClient = useQueryClient();
  const { can, user } = useRole();
  const { data: orders = [], isLoading } = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [assignedTo, setAssignedTo] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Assignment dialog state
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const [assignmentOrders, setAssignmentOrders] = useState<string[]>([]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      // If staff, only show orders assigned to them
      // Viewer can see all orders (read-only)
      if (user?.role === "staff") {
        if (o.assigned_to !== user?.id) return false;
      }

      const q = search.trim().toLowerCase();
      if (
        q &&
        !o.order_number.toLowerCase().includes(q) &&
        !o.customer_name.toLowerCase().includes(q)
      )
        return false;
      if (status !== "all" && o.status !== status) return false;
      if (source !== "all" && o.source !== source) return false;
      if (payment !== "all" && o.payment_method !== payment) return false;
      if (assignedTo !== "all") {
        if (assignedTo === "unassigned") {
          if (o.assigned_to !== null) return false;
        } else {
          if (o.assigned_to !== assignedTo) return false;
        }
      }
      const created = new Date(o.created_at);
      if (from && created < new Date(`${from}T00:00:00`)) return false;
      if (to && created > new Date(`${to}T23:59:59`)) return false;
      return true;
    });
  }, [orders, search, status, source, payment, assignedTo, from, to, user?.id, user?.role]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, status, source, payment, assignedTo, from, to, user?.id, user?.role]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const paginatedOrders = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const bulk = useMutation({
    mutationFn: async (action: string) => {
      if (action === "delete") return deleteOrders(selected);

      const orderToUpdate = orders.find(o => selected.includes(o.id));
      const oldStatus = orderToUpdate?.status;

      if (action === "cancel") {
        await updateOrderStatus(selected, { status: "cancelled", payment_status: "refunded" });
        // Record status change for each order
        for (const orderId of selected) {
          await recordStatusChange(orderId, oldStatus || null, "cancelled", user?.id || null);
        }
      } else {
        await updateOrderStatus(selected, {
          status: action,
          payment_status: action === "completed" ? "paid" : "unpaid",
        });
        // Record status change for each order
        for (const orderId of selected) {
          await recordStatusChange(orderId, oldStatus || null, action, user?.id || null);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`${selected.length} order(s) updated`);
      setSelected([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (!selectedAssignee) throw new Error("Please select an employee");
      if (assignmentOrders.length === 0) throw new Error("Please select orders to assign");

      // Get old assignments
      const ordersToAssign = orders.filter(o => assignmentOrders.includes(o.id));

      await assignOrders(assignmentOrders, selectedAssignee, user?.id || "");

      // Record assignment change for each order
      for (const order of ordersToAssign) {
        await recordAssignmentChange(order.id, order.assigned_to || null, selectedAssignee, user?.id || null);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`${assignmentOrders.length} order(s) assigned`);
      setShowAssignDialog(false);
      setAssignmentOrders([]);
      setSelectedAssignee("");
      setSelected([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async () => {
      if (selected.length === 0) throw new Error("Please select orders");

      // Get old assignments
      const ordersToUnassign = orders.filter(o => selected.includes(o.id));

      await unassignOrders(selected);

      // Record assignment change for each order
      for (const order of ordersToUnassign) {
        await recordAssignmentChange(order.id, order.assigned_to || null, null, user?.id || null);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(`${selected.length} order(s) unassigned`);
      setSelected([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allChecked = filtered.length > 0 && selected.length === filtered.length;

  const exportRows = filtered.map((o) => ({
    Order: o.order_number,
    Customer: o.customer_name,
    Source: o.source,
    Status: o.status,
    Payment: `${o.payment_method} / ${o.payment_status}`,
    Subtotal: Number(o.subtotal),
    Discount: Number(o.discount),
    Tax: Number(o.tax),
    Total: Number(o.total),
    Date: formatDate(o.created_at),
  }));

  return (
    <AppShell
      title="Orders"
      subtitle="All orders from WhatsApp, walk-in and manual channels."
      actions={
        <>
          <ExportMenu rows={exportRows} filename="ibird-orders" title="Orders" />
          <Button asChild className="gap-2">
            <Link to="/pos">
              <Plus className="size-4" /> New Order
            </Link>
          </Button>
        </>
      }
    >
      <div className="card-surface p-4">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search order or customer"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="walk-in">Walk-in</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger>
                <SelectValue placeholder="Payment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All payments</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="From date"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To date"
            />
            {(user?.role === "admin" || user?.role === "manager" || user?.role === "viewer") && (
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Assigned to" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {employees
                    .filter((emp) => emp.role === "staff" || emp.role === "admin" || emp.role === "manager")
                    .map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {selected.length > 0 && can("edit") && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-secondary p-3">
            <span className="text-sm font-semibold">{selected.length} selected</span>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("processing")}>
              Mark processing
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("shipped")}>
              Mark shipped
            </Button>
            <Button size="sm" onClick={() => bulk.mutate("completed")}>
              Mark completed
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("cancel")}>
              Cancel & refund
            </Button>
            {(can("admin") || can("manageStaff")) && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAssignmentOrders(selected);
                    setShowAssignDialog(true);
                  }}
                >
                  <User className="size-3 mr-1" /> Assign
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => unassign.mutate()}
                >
                  <X className="size-3 mr-1" /> Unassign
                </Button>
              </>
            )}
            {can("delete") && (
              <Button size="sm" variant="destructive" onClick={() => bulk.mutate("delete")}>
                Delete
              </Button>
            )}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={(v) => setSelected(v ? filtered.map((o) => o.id) : [])}
                  />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                {(can("admin") || can("manageStaff")) && <TableHead>Assigned To</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    Loading orders…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !filtered.length && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    No orders match these filters.
                  </TableCell>
                </TableRow>
              )}
              {paginatedOrders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(o.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) =>
                          v ? [...prev, o.id] : prev.filter((id) => id !== o.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="font-semibold">{o.order_number}</TableCell>
                  <TableCell>{o.customer_name}</TableCell>
                  <TableCell>
                    <StatusBadge value={o.source} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={o.status} />
                  </TableCell>
                  <TableCell className="capitalize">
                    {o.payment_method} · {o.payment_status}
                  </TableCell>
                  {(can("admin") || can("manageStaff")) && (
                    <TableCell className="text-sm">
                      {o.assigned_to
                        ? employees.find((e) => e.id === o.assigned_to)?.name || "Unknown"
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(o.total)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(o.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/orders/$orderId" params={{ orderId: o.id }}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        {filtered.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(startIndex + ITEMS_PER_PAGE, filtered.length)} of{" "}
              {filtered.length} orders
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Assignment Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Orders to Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Select Employee</Label>
              <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choose employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter((emp) => emp.role === "staff" || emp.role === "admin" || emp.role === "manager")
                    .map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name} ({emp.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              Assigning <span className="font-semibold">{assignmentOrders.length}</span> order(s)
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => assign.mutate()} disabled={assign.isPending || !selectedAssignee}>
              {assign.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

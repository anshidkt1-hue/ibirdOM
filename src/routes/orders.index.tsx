import { createFileRoute, Link } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Search,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ScopedExportMenu, type ExportScope } from "@/components/export-menu";
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
import {
  assignOrders,
  bulkChangeStatus,
  deleteOrders,
  fetchEmployees,
  fetchItemsForOrders,
  fetchOrderIds,
  fetchOrdersByIds,
  fetchOrdersMatching,
  fetchOrdersPage,
  unassignOrders,
  type Employee,
  type Order,
  type OrderFilters,
} from "@/lib/data";
import type { ExportRow } from "@/lib/export";
import { formatCurrency, formatDate } from "@/lib/format";
import { useRole } from "@/components/role-provider";

const STATUSES = ["pending", "processing", "shipped", "completed", "cancelled"];
const PAGE_SIZES = [10, 25, 50, 100, 250, 500, 1000, 2500];
const CONFIRM_ABOVE = 50;

export const Route = createFileRoute("/orders/")({
  head: () => ({
    meta: [
      { title: "Orders — ibird Order Management" },
      {
        name: "description",
        content:
          "View, filter and process ibird WhatsApp orders with bulk actions and exports.",
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

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function toExportRows(orders: Order[], employees: Employee[], items: Map<string, string>): ExportRow[] {
  const names = new Map(employees.map((e) => [e.id, e.name]));
  return orders.map((o) => ({
    Order: o.order_number,
    Date: formatDate(o.created_at),
    Customer: o.customer_name,
    Phone: o.customer_phone ?? "",
    Address: o.delivery_address ?? "",
    Channel: o.source,
    Status: o.status,
    Payment: `${o.payment_method} / ${o.payment_status}`,
    "Assigned To": o.assigned_to ? (names.get(o.assigned_to) ?? "Unknown") : "",
    Items: items.get(o.id) ?? "",
    Subtotal: Number(o.subtotal),
    Discount: Number(o.discount),
    Tax: Number(o.tax),
    Total: Number(o.total),
  }));
}

// Memoised so ticking one checkbox does not re-render the other rows of a 2,500-row page.
const OrderRow = memo(function OrderRow({
  order,
  checked,
  onToggle,
  showAssignColumn,
  assigneeName,
}: {
  order: Order;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
  showAssignColumn: boolean;
  assigneeName: string;
}) {
  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onToggle(order.id, v === true)}
          aria-label={`Select order ${order.order_number}`}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap font-semibold">
        <Link
          to="/orders/$orderId"
          params={{ orderId: order.id }}
          className="text-primary underline-offset-4 hover:underline"
        >
          {order.order_number}
        </Link>
      </TableCell>
      <TableCell className="max-w-[12rem] truncate">{order.customer_name}</TableCell>
      <TableCell>
        <StatusBadge value={order.source} />
      </TableCell>
      <TableCell>
        <StatusBadge value={order.status} />
      </TableCell>
      <TableCell className="capitalize">
        {order.payment_method} · {order.payment_status}
      </TableCell>
      {showAssignColumn && <TableCell className="text-sm">{assigneeName}</TableCell>}
      <TableCell className="text-right font-semibold">{formatCurrency(order.total)}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDate(order.created_at)}
      </TableCell>
      <TableCell className="text-right">
        <Button asChild size="sm" variant="ghost">
          <Link to="/orders/$orderId" params={{ orderId: order.id }}>
            View
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
});

function OrdersPage() {
  const queryClient = useQueryClient();
  const { can, user } = useRole();
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [payment, setPayment] = useState("all");
  const [assignedTo, setAssignedTo] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pageInput, setPageInput] = useState("1");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState("");

  const debouncedSearch = useDebounced(search);
  const isStaff = user?.role === "staff";

  const filters: OrderFilters = useMemo(
    () => ({
      search: debouncedSearch,
      status,
      source,
      excludeSource: "counter",
      payment,
      assignedTo,
      from,
      to,
      staffId: isStaff ? user?.id : undefined,
    }),
    [debouncedSearch, status, source, payment, assignedTo, from, to, isStaff, user?.id],
  );

  const filterKey = JSON.stringify(filters);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["orders", "page", filterKey, page, pageSize],
    queryFn: () => fetchOrdersPage(filters, page, pageSize),
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [filterKey, pageSize]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageIds = rows.map((o) => o.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => allMatching || selected.has(id));
  const someOnPageSelected = !allOnPageSelected && pageIds.some((id) => selected.has(id));
  const selectedCount = allMatching ? total : selected.size;
  const canSelectAllMatching = !allMatching && allOnPageSelected && total > pageIds.length;

  const togglePage = (checked: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const employeeNames = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name])),
    [employees],
  );

  const clearSelection = () => {
    setSelected(new Set());
    setAllMatching(false);
  };

  const resolveSelectedIds = async (): Promise<string[]> => {
    if (!allMatching) return [...selected];
    const toastId = toast.loading("Collecting all matching orders…");
    try {
      const ids = await fetchOrderIds(filters, (n) =>
        toast.loading(`Collecting orders… ${n.toLocaleString("en-IN")}`, { id: toastId }),
      );
      toast.dismiss(toastId);
      return ids;
    } catch (e) {
      toast.dismiss(toastId);
      throw e;
    }
  };

  const confirmLarge = (count: number, verb: string) =>
    count <= CONFIRM_ABOVE ||
    window.confirm(`${verb} ${count.toLocaleString("en-IN")} orders? This cannot be undone easily.`);

  const afterChange = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    toast.success(message);
    clearSelection();
  };

  const withProgress = async (label: string, work: (report: (n: number) => void) => Promise<void>) => {
    const toastId = toast.loading(`${label}…`);
    try {
      await work((n) => toast.loading(`${label}… ${n.toLocaleString("en-IN")}`, { id: toastId }));
    } finally {
      toast.dismiss(toastId);
    }
  };

  const bulk = useMutation({
    mutationFn: async (action: string) => {
      const ids = await resolveSelectedIds();
      if (!ids.length) throw new Error("No orders selected");

      if (action === "delete") {
        if (!confirmLarge(ids.length, "Permanently delete")) return null;
        await withProgress("Deleting", async () => deleteOrders(ids));
        return `${ids.length.toLocaleString("en-IN")} order(s) deleted`;
      }

      const newStatus = action === "cancel" ? "cancelled" : action;
      if (!confirmLarge(ids.length, `Mark as ${newStatus}`)) return null;
      await withProgress("Updating", (report) =>
        bulkChangeStatus(ids, newStatus, user?.id || null, report),
      );
      return `${ids.length.toLocaleString("en-IN")} order(s) updated`;
    },
    onSuccess: (message) => {
      if (message) afterChange(message);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (!selectedAssignee) throw new Error("Please select an employee");
      const ids = await resolveSelectedIds();
      if (!ids.length) throw new Error("No orders selected");
      await withProgress("Assigning", (report) =>
        assignOrders(ids, selectedAssignee, user?.id || "", report),
      );
      return ids.length;
    },
    onSuccess: (count) => {
      setShowAssignDialog(false);
      setSelectedAssignee("");
      afterChange(`${count.toLocaleString("en-IN")} order(s) assigned`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassign = useMutation({
    mutationFn: async () => {
      const ids = await resolveSelectedIds();
      if (!ids.length) throw new Error("No orders selected");
      await withProgress("Unassigning", (report) => unassignOrders(ids, user?.id || null, report));
      return ids.length;
    },
    onSuccess: (count) => afterChange(`${count.toLocaleString("en-IN")} order(s) unassigned`),
    onError: (e: Error) => toast.error(e.message),
  });

  const working = bulk.isPending || assign.isPending || unassign.isPending;

  const withItems = async (
    orders: Order[],
    onProgress?: (loaded: number) => void,
  ): Promise<ExportRow[]> => {
    const items = await fetchItemsForOrders(
      orders.map((o) => o.id),
      onProgress,
    );
    const byOrder = new Map<string, string[]>();
    items.forEach((i) => {
      const list = byOrder.get(i.order_id) ?? [];
      list.push(`${i.product_name} x${i.quantity}`);
      byOrder.set(i.order_id, list);
    });
    const joined = new Map([...byOrder].map(([id, list]) => [id, list.join("; ")]));
    return toExportRows(orders, employees, joined);
  };

  const exportScopes: ExportScope[] = [
    {
      key: "page",
      label: `This page (${rows.length.toLocaleString("en-IN")})`,
      getRows: async (onProgress) => withItems(rows, onProgress),
    },
    {
      key: "selected",
      label: `Selected (${selectedCount.toLocaleString("en-IN")})`,
      hidden: selectedCount === 0,
      getRows: async (onProgress) => {
        if (allMatching) {
          return withItems(await fetchOrdersMatching(filters, onProgress), onProgress);
        }
        // Reuse rows already on screen when the whole selection is on this page (no extra fetch).
        const onPage = rows.filter((o) => selected.has(o.id));
        if (onPage.length === selected.size) return withItems(onPage, onProgress);
        return withItems(await fetchOrdersByIds([...selected], onProgress), onProgress);
      },
    },
    {
      key: "all-matching",
      label: `All matching current filters (${total.toLocaleString("en-IN")})`,
      getRows: async (onProgress) => withItems(await fetchOrdersMatching(filters, onProgress)),
    },
  ];

  const showAssignColumn = can("admin") || can("manageStaff");
  const colSpan = showAssignColumn ? 10 : 9;
  const startIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  const goToPage = (value: number) => {
    if (Number.isNaN(value)) return;
    setPage(Math.min(totalPages, Math.max(1, Math.trunc(value))));
  };

  return (
    <AppShell
      title="Orders"
      subtitle="WhatsApp orders to pack and deliver. Counter sales are in Invoices."
      actions={
        <>
          <ScopedExportMenu scopes={exportScopes} filename="ibird-orders" title="Orders" />
        </>
      }
    >
      <div className="card-surface p-4">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search order number, customer or phone"
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
                <SelectItem value="razorpay">Razorpay</SelectItem>
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

        {selectedCount > 0 && (
          <div className="mt-4 space-y-2 rounded-lg bg-secondary p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {selectedCount.toLocaleString("en-IN")} selected
              </span>
              {can("edit") && (
                <>
                  <Button size="sm" variant="outline" disabled={working} onClick={() => bulk.mutate("processing")}>
                    Mark processing
                  </Button>
                  <Button size="sm" variant="outline" disabled={working} onClick={() => bulk.mutate("shipped")}>
                    Mark shipped
                  </Button>
                  <Button size="sm" disabled={working} onClick={() => bulk.mutate("completed")}>
                    Mark completed
                  </Button>
                  <Button size="sm" variant="outline" disabled={working} onClick={() => bulk.mutate("cancel")}>
                    Cancel & refund
                  </Button>
                </>
              )}
              {showAssignColumn && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={working}
                    onClick={() => setShowAssignDialog(true)}
                  >
                    <User className="size-3 mr-1" /> Assign
                  </Button>
                  <Button size="sm" variant="outline" disabled={working} onClick={() => unassign.mutate()}>
                    <X className="size-3 mr-1" /> Unassign
                  </Button>
                </>
              )}
              {can("delete") && (
                <Button size="sm" variant="destructive" disabled={working} onClick={() => bulk.mutate("delete")}>
                  Delete
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear selection
              </Button>
              {working && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            {canSelectAllMatching && (
              <p className="text-sm">
                All {pageIds.length} orders on this page are selected.{" "}
                <button
                  type="button"
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={() => setAllMatching(true)}
                >
                  Select all {total.toLocaleString("en-IN")} matching orders
                </button>
              </p>
            )}
            {allMatching && (
              <p className="text-sm">
                All {total.toLocaleString("en-IN")} matching orders are selected, across every page.{" "}
                <button
                  type="button"
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={clearSelection}
                >
                  Clear selection
                </button>
              </p>
            )}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => togglePage(v === true)}
                    aria-label="Select all orders on this page"
                  />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                {showAssignColumn && <TableHead>Assigned To</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
                    Loading orders…
                  </TableCell>
                </TableRow>
              )}
              {error && !isLoading && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-10 text-center text-destructive">
                    Could not load orders: {error instanceof Error ? error.message : "unknown error"}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && !rows.length && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
                    No orders match these filters.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  checked={allMatching || selected.has(o.id)}
                  onToggle={toggleOne}
                  showAssignColumn={showAssignColumn}
                  assigneeName={o.assigned_to ? (employeeNames.get(o.assigned_to) ?? "Unknown") : "—"}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              {total === 0
                ? "No orders"
                : `Showing ${startIndex.toLocaleString("en-IN")}–${endIndex.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} orders`}
            </span>
            {isFetching && !isLoading && <Loader2 className="size-3.5 animate-spin" />}
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>Page</span>
              <Input
                className="h-8 w-16 text-center"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                onBlur={() => goToPage(Number(pageInput))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goToPage(Number(pageInput));
                }}
                aria-label="Go to page"
              />
              <span>of {totalPages.toLocaleString("en-IN")}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              aria-label="Last page"
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

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
              Assigning <span className="font-semibold">{selectedCount.toLocaleString("en-IN")}</span>{" "}
              order(s)
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

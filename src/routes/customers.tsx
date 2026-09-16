import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import React, { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, UserPlus, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ExportMenu } from "@/components/export-menu";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteRecord,
  fetchCustomers,
  fetchOrders,
  upsertRecord,
  type Customer,
} from "@/lib/data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useRole } from "@/components/role-provider";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — ibird Customer Management" },
      {
        name: "description",
        content:
          "ibird customer directory with lifetime spend, order counts, geography and new-vs-repeat analytics.",
      },
      { property: "og:title", content: "Customers — ibird Customer Management" },
      {
        property: "og:description",
        content: "Search customers, track lifetime value and export the directory.",
      },
    ],
  }),
  component: CustomersPage,
});

const empty = {
  name: "",
  phone: "",
  email: "",
  city: "",
  state: "",
  customer_type: "retail",
};

function CustomersPage() {
  const queryClient = useQueryClient();
  const { can } = useRole();
  const location = useLocation();

  // If the pathname is longer than /customers, we're on a child route - render the Outlet
  if (location.pathname !== "/customers") {
    return <Outlet />;
  }

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; spend: number; last: string }>();
    for (const o of orders) {
      if (!o.customer_id) continue;
      const cur = map.get(o.customer_id) ?? { count: 0, spend: 0, last: o.created_at };
      cur.count += 1;
      cur.spend += Number(o.total);
      if (o.created_at > cur.last) cur.last = o.created_at;
      map.set(o.customer_id, cur);
    }
    return map;
  }, [orders]);

  const rows = useMemo(() => {
    return customers
      .filter((c) => {
        const q = search.trim().toLowerCase();
        return (
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q) ||
          (c.city ?? "").toLowerCase().includes(q)
        );
      })
      .map((c) => ({ customer: c, stat: stats.get(c.id) }));
  }, [customers, search, stats]);

  // Reset to first page when search changes
  React.useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE);
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const paginatedRows = rows.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const repeat = customers.filter((c) => (stats.get(c.id)?.count ?? 0) > 1).length;
  const totalSpend = orders.reduce((s, o) => s + Number(o.total), 0);

  const save = useMutation({
    mutationFn: () => upsertRecord("customers", form, editing?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(editing ? "Customer updated" : "Customer added");
      setOpen(false);
      setEditing(null);
      setForm({ ...empty });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRecord("customers", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Customers"
      subtitle="Directory, lifetime value and repeat-purchase insight."
      actions={
        <>
          <ExportMenu
            filename="ibird-customers"
            title="Customers"
            rows={rows.map(({ customer: c, stat }) => ({
              Name: c.name,
              Phone: c.phone ?? "",
              Email: c.email ?? "",
              City: c.city ?? "",
              State: c.state ?? "",
              Type: c.customer_type,
              Orders: stat?.count ?? 0,
              Spend: stat?.spend ?? 0,
            }))}
          />
          {can("edit") && (
            <Button
              className="gap-2"
              onClick={() => {
                setEditing(null);
                setForm({ ...empty });
                setOpen(true);
              }}
            >
              <Plus className="size-4" /> Add customer
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Customers" value={formatNumber(customers.length)} icon={Users} />
        <StatCard
          label="Repeat customers"
          value={formatNumber(repeat)}
          hint={`${customers.length - repeat} new`}
          icon={UserPlus}
          tone="brand"
        />
        <StatCard
          label="Lifetime revenue"
          value={formatCurrency(totalSpend)}
          hint="All orders"
          icon={Users}
          tone="success"
        />
      </div>

      <div className="card-surface mt-5 p-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, phone or city"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Last order</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.map(({ customer: c, stat }) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.phone}
                    <br />
                    <span className="text-xs">{c.email}</span>
                  </TableCell>
                  <TableCell>
                    {c.city}
                    {c.state ? `, ${c.state}` : ""}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={c.customer_type} />
                  </TableCell>
                  <TableCell className="text-right">{stat?.count ?? 0}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(stat?.spend ?? 0)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {stat ? formatDate(stat.last) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/customers/$customerId" params={{ customerId: c.id }}>
                        View
                      </Link>
                    </Button>
                    {can("edit") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(c);
                          setForm({
                            name: c.name,
                            phone: c.phone ?? "",
                            email: c.email ?? "",
                            city: c.city ?? "",
                            state: c.state ?? "",
                            customer_type: c.customer_type,
                          });
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                    {can("delete") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => remove.mutate(c.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        {rows.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(startIndex + ITEMS_PER_PAGE, rows.length)} of {rows.length}{" "}
              customers
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit customer" : "Add customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["name", "Name"],
                ["phone", "Phone"],
                ["email", "Email"],
                ["city", "City"],
                ["state", "State"],
                ["customer_type", "Type"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <Label>{label}</Label>
                <Input
                  className="mt-1"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!form.name || save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

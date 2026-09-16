import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, IndianRupee, Plus, Search, Users, ChevronLeft, ChevronRight } from "lucide-react";
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
import { deleteRecord, fetchEmployees, upsertRecord, type Employee } from "@/lib/data";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { ROLE_LABELS, useRole } from "@/components/role-provider";
import { hashPasswordForStorage } from "@/lib/auth";

export const Route = createFileRoute("/employees")({
  head: () => ({
    meta: [
      { title: "Employees — ibird Staff & Access Control" },
      {
        name: "description",
        content:
          "Manage the ibird staff directory: roles and permissions, departments, salaries and employment status.",
      },
      { property: "og:title", content: "Employees — ibird Staff & Access Control" },
      {
        property: "og:description",
        content: "Admin, Manager, Staff and Viewer roles with salary and department tracking.",
      },
    ],
  }),
  component: EmployeesPage,
});

const empty = {
  name: "",
  email: "",
  phone: "",
  role: "staff",
  department: "",
  salary: 0,
  status: "active",
  join_date: new Date().toISOString().split("T")[0],
  password: "",
};

const PERMISSIONS: Record<string, string> = {
  admin: "Full access — orders, inventory, staff, reports, deletion",
  manager: "Manage orders, inventory and reports; no staff deletion",
  staff: "Create orders and adjust stock; no access to reports",
  viewer: "Read-only across all modules",
};

function EmployeesPage() {
  const queryClient = useQueryClient();
  const { can } = useRole();
  const location = useLocation();

  // If the pathname is longer than /employees, we're on a child route - render the Outlet
  if (location.pathname !== "/employees") {
    return <Outlet />;
  }

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const rows = useMemo(() => {
    return employees.filter((e) => {
      const q = search.trim().toLowerCase();
      return (
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE);
  const startIndex = (page - 1) * ITEMS_PER_PAGE;
  const paginatedRows = rows.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const payroll = employees
    .filter((e) => e.status === "active")
    .reduce((s, e) => s + Number(e.salary), 0);

  const save = useMutation({
    mutationFn: () => {
      // For new employees, password is required if admin
      if (!editing && can("admin") && !form.password) {
        throw new Error("Password is required for new employees");
      }

      // Build the data object, only include password if it has a value
      const data: any = { ...form, salary: Number(form.salary) };

      // Hash password if provided
      if (form.password) {
        try {
          data.password = hashPasswordForStorage(form.password);
        } catch (e) {
          throw new Error("Failed to process password");
        }
      } else if (editing) {
        // Remove password field for updates if no password provided (to keep current password)
        delete data.password;
      }

      return upsertRecord("employees", data, editing?.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(editing ? "Employee updated" : "Employee added");
      setOpen(false);
      setEditing(null);
      setForm({ ...empty });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRecord("employees", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Employee removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Employees"
      subtitle="Staff directory, roles, permissions and salaries."
      actions={
        <>
          <ExportMenu
            filename="ibird-employees"
            title="Employees"
            rows={rows.map((e) => ({
              Name: e.name,
              Email: e.email ?? "",
              Phone: e.phone ?? "",
              Role: e.role,
              Department: e.department ?? "",
              Salary: Number(e.salary),
              Status: e.status,
              Joined: formatDate(e.join_date),
            }))}
          />
          {can("manageStaff") && (
            <Button
              className="gap-2"
              onClick={() => {
                setEditing(null);
                setForm({ ...empty });
                setOpen(true);
              }}
            >
              <Plus className="size-4" /> Add employee
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Team size" value={formatNumber(employees.length)} icon={Users} />
        <StatCard
          label="Active staff"
          value={formatNumber(employees.filter((e) => e.status === "active").length)}
          icon={BadgeCheck}
          tone="success"
        />
        <StatCard
          label="Monthly payroll"
          value={formatCurrency(payroll)}
          hint="Active employees"
          icon={IndianRupee}
          tone="brand"
        />
      </div>

      <div className="card-surface mt-5 p-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, role or department"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Salary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-semibold">{e.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.email}
                    <br />
                    <span className="text-xs">{e.phone}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={e.role} />
                  </TableCell>
                  <TableCell>{e.department}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(e.salary)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={e.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(e.join_date)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/employees/$employeeId" params={{ employeeId: e.id }}>
                        View
                      </Link>
                    </Button>
                    {can("manageStaff") && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(e);
                            setForm({
                              name: e.name,
                              email: e.email ?? "",
                              phone: e.phone ?? "",
                              role: e.role,
                              department: e.department ?? "",
                              salary: Number(e.salary),
                              status: e.status,
                              join_date: e.join_date,
                              password: "",
                            });
                            setOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        {can("delete") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => remove.mutate(e.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </>
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
              employees
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
            <DialogTitle>{editing ? "Edit employee" : "Add employee"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                className="mt-1"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                className="mt-1"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Department</Label>
              <Input
                className="mt-1"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on-leave">On leave</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monthly salary</Label>
              <Input
                type="text"
                inputMode="decimal"
                className="mt-1"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value === "" ? 0 : Number(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Join date</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.join_date}
                onChange={(e) => setForm({ ...form, join_date: e.target.value })}
              />
            </div>
            {can("admin") && (
              <div className="sm:col-span-2">
                <Label>Password {!editing && <span className="text-destructive">*</span>}</Label>
                <Input
                  type="password"
                  className="mt-1"
                  placeholder={editing ? "Leave blank to keep current password" : "Enter password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {editing ? "Leave blank to keep the current password unchanged" : "Password required for new employees"}
                </p>
              </div>
            )}
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

import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Mail, Phone, Building2, Briefcase, DollarSign, Calendar } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { fetchEmployees } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";

export const Route = createFileRoute("/employees/$employeeId")({
  head: () => ({
    meta: [
      { title: "Employee Profile — ibird" },
      { name: "description", content: "Employee details, role, permissions and history." },
    ],
  }),
  component: EmployeeDetail,
});

function EmployeeDetail() {
  const { employeeId } = useParams({ from: "/employees/$employeeId" });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
  });

  const employee = employees.find((e) => e.id === employeeId);

  if (!employee) {
    return (
      <AppShell title="Employee" subtitle="Not found">
        <div className="card-surface p-8 text-center text-muted-foreground">Employee not found</div>
      </AppShell>
    );
  }

  const roleDescriptions: Record<string, { desc: string; color: string }> = {
    admin: {
      desc: "Full access — orders, inventory, staff, reports, deletion",
      color: "bg-destructive",
    },
    manager: {
      desc: "Manage orders, inventory and reports; no staff deletion",
      color: "bg-warning",
    },
    staff: {
      desc: "Create orders and adjust stock; no access to reports",
      color: "bg-blue-500",
    },
    viewer: {
      desc: "Read-only across all modules",
      color: "bg-gray-500",
    },
  };

  const roleInfo = roleDescriptions[employee.role.toLowerCase()] || roleDescriptions.viewer;
  const tenure = employee.join_date
    ? Math.floor(
        (new Date().getTime() - new Date(employee.join_date).getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
    : 0;

  return (
    <AppShell
      title={employee.name}
      subtitle={`${employee.role.charAt(0).toUpperCase() + employee.role.slice(1)} • ${employee.department || "No department"}`}
      actions={
        <Button variant="outline" asChild className="gap-2">
          <Link to="/employees">
            <ArrowLeft className="size-4" /> Back
          </Link>
        </Button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Main Info */}
        <div className="space-y-5 lg:col-span-2">
          {/* Contact Information */}
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold mb-4">Contact Information</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Mail className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Email</p>
                  <p className="text-sm">{employee.email || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Phone</p>
                  <p className="text-sm">{employee.phone || "—"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Work Information */}
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold mb-4">Work Information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <Briefcase className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Role</p>
                  <p className="mt-1">
                    <StatusBadge value={employee.role} />
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Department</p>
                  <p className="text-sm mt-1">{employee.department || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Join Date</p>
                  <p className="text-sm mt-1">{formatDate(employee.join_date)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Tenure</p>
                  <p className="text-sm mt-1">{tenure} months</p>
                </div>
              </div>
            </div>
          </div>

          {/* Compensation */}
          <div className="card-surface p-5">
            <h2 className="text-lg font-bold mb-4">Compensation</h2>
            <div className="flex items-start gap-3">
              <DollarSign className="size-5 text-success flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Monthly Salary</p>
                <p className="text-2xl font-bold mt-1 text-success">
                  {formatCurrency(employee.salary)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Status Card */}
          <div className="card-surface p-5">
            <h3 className="font-semibold mb-3">Status</h3>
            <StatusBadge value={employee.status} />
          </div>

          {/* Role & Permissions */}
          <div className="card-surface p-5">
            <h3 className="font-semibold mb-3">Permissions</h3>
            <div className="space-y-3">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  {employee.role}
                </p>
                <p className="text-sm">{roleInfo.desc}</p>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="card-surface p-5">
            <h3 className="font-semibold mb-3">Summary</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Annual Package</span>
                <span className="font-semibold">{formatCurrency(employee.salary * 12)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Joined</span>
                <span className="text-xs">{formatDate(employee.join_date)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

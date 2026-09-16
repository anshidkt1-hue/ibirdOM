import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Boxes,
  ChevronLeft,
  FileBarChart,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Package,
  Receipt,
  Settings as SettingsIcon,
  ShoppingCart,
  Sun,
  Users,
  UserSquare2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, useRole, type Role } from "@/components/role-provider";
import { useNotifications } from "@/hooks/use-notifications";
import { logout } from "@/lib/auth";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid },
  { to: "/pos", label: "Point of Sale", icon: ShoppingCart },
  { to: "/orders", label: "Orders", icon: Receipt },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/employees", label: "Employees", icon: UserSquare2 },
  { to: "/reports", label: "Reports", icon: FileBarChart },
] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { role, user, setUser } = useRole();
  const notifications = useNotifications();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setUser(null);
      localStorage.removeItem("auth-user");
      toast.success("Logged out successfully");
      navigate({ to: "/login" });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Logout failed");
    },
  });

  const toggleDarkMode = () => {
    const html = document.documentElement;
    if (html.classList.contains("dark")) {
      html.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setIsDarkMode(false);
    } else {
      html.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDarkMode(true);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Package className="size-5" />
          </div>
          <div>
            <p className="text-base font-extrabold tracking-tight text-sidebar-foreground">ibird</p>
            <p className="text-xs text-muted-foreground">Business Suite</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-secondary",
                )}
              >
                <item.icon className="size-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3 space-y-2">
          {/* Settings Link */}
          <Link
            to="/settings"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              pathname === "/settings"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-secondary",
            )}
          >
            <SettingsIcon className="size-[18px]" />
            Settings
          </Link>

          {/* Dark Mode Toggle */}
          <button
            className={cn(
              "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              "text-sidebar-foreground hover:bg-secondary",
            )}
            onClick={toggleDarkMode}
          >
            {isDarkMode ? (
              <>
                <Sun className="size-[18px]" />
                Light Mode
              </>
            ) : (
              <>
                <Moon className="size-[18px]" />
                Dark Mode
              </>
            )}
          </button>

          {/* Profile Section */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary transition-colors">
                <div className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {user?.name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold">{user?.name || "User"}</p>
                  <p className="text-xs text-muted-foreground">{role ? ROLE_LABELS[role as Role] : "Loading..."}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs">
                <p className="text-muted-foreground">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
              >
                <LogOut className="size-4 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {mobileOpen && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-foreground/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="no-print sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-extrabold tracking-tight">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="relative">
                    <Bell className="size-4" />
                    {notifications.length > 0 && (
                      <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                        {notifications.length}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.length === 0 && (
                    <p className="px-2 py-4 text-sm text-muted-foreground">You're all caught up.</p>
                  )}
                  {notifications.map((n) => (
                    <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5">
                      <span className="text-sm font-medium">{n.title}</span>
                      <span className="text-xs text-muted-foreground">{n.description}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

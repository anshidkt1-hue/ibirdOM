import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "admin" | "manager" | "staff" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  name: string;
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

type Ctx = {
  role: Role | null;
  user: AuthUser | null;
  setRole: (r: Role) => void;
  setUser: (user: AuthUser | null) => void;
  can: (action: "view" | "edit" | "delete" | "manageStaff" | "viewReports" | "viewDashboard") => boolean;
  isAuthenticated: boolean;
};

const RoleContext = createContext<Ctx>({
  role: null,
  user: null,
  setRole: () => {},
  setUser: () => {},
  can: () => false,
  isAuthenticated: false,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try to load user from localStorage on mount
    const stored = localStorage.getItem("auth-user");
    if (stored) {
      try {
        const parsedUser = JSON.parse(stored) as AuthUser;
        setUserState(parsedUser);
        setRoleState(parsedUser.role);
      } catch (e) {
        console.error("Failed to parse stored user", e);
      }
    }
    setIsLoading(false);
  }, []);

  const setRole = (r: Role) => {
    setRoleState(r);
  };

  const setUser = (u: AuthUser | null) => {
    setUserState(u);
    if (u) {
      setRoleState(u.role);
    } else {
      setRoleState(null);
    }
  };

  const can: Ctx["can"] = (action) => {
    if (!role) return false;

    if (role === "admin") return true; // Admin can do everything

    if (role === "viewer") return action === "view"; // Viewer can only view

    if (role === "manager") {
      // Manager can do everything except manage staff (no delete)
      return action !== "manageStaff" && action !== "delete";
    }

    if (role === "staff") {
      // Staff can view, edit, create, but not view reports or delete
      // Staff can: view, edit, create orders and adjust stock
      // Staff cannot: view reports, delete, manage staff
      return (
        action === "view" ||
        action === "edit" ||
        (action !== "viewReports" && action !== "delete" && action !== "manageStaff")
      );
    }

    return false;
  };

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  return (
    <RoleContext.Provider
      value={{
        role,
        user,
        setRole,
        setUser,
        can,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export const useRole = () => useContext(RoleContext);

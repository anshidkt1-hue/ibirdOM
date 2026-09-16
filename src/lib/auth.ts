import { supabase } from "@/integrations/supabase/client";

export type AuthUser = {
  id: string;
  email: string;
  role: "admin" | "manager" | "staff" | "viewer";
  name: string;
};

/**
 * Simple password hashing function (for demo purposes)
 * In production, use bcrypt or similar on the backend
 */
function hashPassword(password: string): string {
  // Simple hash using btoa (base64 encoding)
  // In production, use proper bcrypt hashing on backend
  return btoa(password);
}

/**
 * Verify password against stored hash
 */
function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/**
 * Login with email and password
 * Validates credentials against stored password in employee record
 */
export async function loginWithEmail(
  email: string,
  password: string
): Promise<AuthUser> {
  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  // Fetch the employee record by email to validate password
  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, name, email, role, password")
    .eq("email", email)
    .maybeSingle();

  if (error || !employee) {
    throw new Error("Invalid email or password");
  }

  // Check if employee has a password set
  if (!employee.password) {
    throw new Error("Account password not set. Please contact administrator.");
  }

  // Verify the provided password against stored password
  if (!verifyPassword(password, employee.password)) {
    throw new Error("Invalid email or password");
  }

  return {
    id: employee.id,
    email: employee.email || email,
    role: (employee.role || "viewer") as AuthUser["role"],
    name: employee.name || email,
  };
}

/**
 * Hash a password for storage
 * Call this when creating or updating employee passwords
 */
export function hashPasswordForStorage(password: string): string {
  if (!password) {
    throw new Error("Password cannot be empty");
  }
  return hashPassword(password);
}

/**
 * Logout (clears local state)
 */
export async function logout(): Promise<void> {
  // Clear authentication state
  localStorage.removeItem("auth-user");
  return Promise.resolve();
}

/**
 * Get the current authenticated user from localStorage
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const stored = localStorage.getItem("auth-user");
  if (!stored) return null;

  try {
    return JSON.parse(stored) as AuthUser;
  } catch (e) {
    console.error("Failed to parse stored user", e);
    return null;
  }
}

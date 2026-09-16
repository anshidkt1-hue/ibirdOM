import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, Mail, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithEmail } from "@/lib/auth";
import { useRole } from "@/components/role-provider";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login — ibird" },
      { name: "description", content: "Log in to your ibird account" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { setRole: setContextRole, setUser } = useRole();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: () => loginWithEmail(email, password),
    onSuccess: (user) => {
      // Set the authenticated user in the role context
      setContextRole(user.role);
      setUser(user);
      localStorage.setItem("auth-user", JSON.stringify(user));
      toast.success(`Welcome back, ${user.name}!`);
      navigate({ to: "/" });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Login failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter email and password");
      return;
    }
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/10 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Package className="size-6" />
            </div>
            <div>
              <p className="text-xl font-extrabold tracking-tight">ibird</p>
              <p className="text-xs text-muted-foreground">Business Suite</p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="card-surface rounded-xl border border-border p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Welcome back</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in to your ibird account to continue
          </p>


          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative mt-1.5">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  disabled={loginMutation.isPending}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  disabled={loginMutation.isPending}
                />
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full mt-6"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>

        </div>
      </div>
    </div>
  );
}

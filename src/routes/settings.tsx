import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Shield } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { fetchSettings, saveSettings } from "@/lib/data";
import { useRole } from "@/components/role-provider";
import { StatusBadge } from "@/components/status-badge";

// Role permissions definition - outside component for better performance
const ROLE_PERMISSIONS: Record<string, { desc: string; access: string[]; restrictions: string[] }> = {
  admin: {
    desc: "Full access to all features",
    access: ["Orders", "Inventory", "Staff Management", "Reports & Analytics", "Settings", "Delete Records"],
    restrictions: [],
  },
  manager: {
    desc: "Manage operations and reports",
    access: ["Orders", "Inventory", "Reports & Analytics", "View Staff"],
    restrictions: ["Cannot delete employees", "Cannot access Settings"],
  },
  staff: {
    desc: "Create and manage day-to-day operations",
    access: ["Create Orders", "Adjust Stock", "View Orders", "View Customers"],
    restrictions: ["Cannot view Reports", "Cannot manage Staff", "Cannot delete records"],
  },
  viewer: {
    desc: "Read-only access across all modules",
    access: ["View Orders", "View Inventory", "View Customers", "View Employees", "View Reports"],
    restrictions: ["Cannot create or edit anything", "Cannot delete anything"],
  },
};

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ibird" },
      { name: "description", content: "Business settings and configuration." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { can } = useRole();
  const queryClient = useQueryClient();
  const { data: settings = {}, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const [formData, setFormData] = React.useState(() => settings);

  React.useEffect(() => {
    // Only sync formData with settings on initial mount
    setFormData(settings);
  }, []);

  const saveMutation = useMutation({
    mutationFn: (data: typeof formData) => saveSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleChange = (key: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your business configuration"
      actions={
        can("admin") && (
          <Button
            className="gap-2"
            onClick={handleSave}
            disabled={saveMutation.isPending || isLoading}
          >
            <Save className="size-4" />{" "}
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        )
      }
    >
      <div className="card-surface" style={{ opacity: isLoading ? 0.6 : 1, transition: "opacity 0.3s" }}>
        <Tabs defaultValue="company" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="tax">Tax & Pricing</TabsTrigger>
            <TabsTrigger value="localization">Localization</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
            <TabsTrigger value="access">Access Control</TabsTrigger>
          </TabsList>

          {/* Company Settings */}
          <TabsContent value="company" className="space-y-6 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="company_name">Company Name</Label>
                <Input
                  id="company_name"
                  className="mt-2"
                  value={formData.company_name || ""}
                  onChange={(e) =>
                    handleChange("company_name", e.target.value)
                  }
                  placeholder="e.g., ibird Cookware"
                  disabled={!can("admin")}
                />
              </div>
              <div>
                <Label htmlFor="company_email">Email</Label>
                <Input
                  id="company_email"
                  className="mt-2"
                  type="email"
                  value={formData.company_email || ""}
                  onChange={(e) =>
                    handleChange("company_email", e.target.value)
                  }
                  placeholder="contact@company.com"
                  disabled={!can("admin")}
                />
              </div>
              <div>
                <Label htmlFor="company_phone">Phone</Label>
                <Input
                  id="company_phone"
                  className="mt-2"
                  value={formData.company_phone || ""}
                  onChange={(e) =>
                    handleChange("company_phone", e.target.value)
                  }
                  placeholder="+91 XXXXX XXXXX"
                  disabled={!can("admin")}
                />
              </div>
              <div>
                <Label htmlFor="company_website">Website</Label>
                <Input
                  id="company_website"
                  className="mt-2"
                  value={formData.company_website || ""}
                  onChange={(e) =>
                    handleChange("company_website", e.target.value)
                  }
                  placeholder="https://example.com"
                  disabled={!can("admin")}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="company_address">Address</Label>
              <textarea
                id="company_address"
                className="mt-2 min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.company_address || ""}
                onChange={(e) =>
                  handleChange("company_address", e.target.value)
                }
                placeholder="Street address, city, state, postal code"
                disabled={!can("admin")}
              />
            </div>

            <div>
              <Label htmlFor="company_description">Description</Label>
              <textarea
                id="company_description"
                className="mt-2 min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.company_description || ""}
                onChange={(e) =>
                  handleChange("company_description", e.target.value)
                }
                placeholder="Business description for invoices and receipts"
                disabled={!can("admin")}
              />
            </div>
          </TabsContent>

          {/* Tax & Pricing Settings */}
          <TabsContent value="tax" className="space-y-6 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tax_rate">Tax Rate (%)</Label>
                <Input
                  id="tax_rate"
                  className="mt-2"
                  type="number"
                  inputMode="decimal"
                  value={formData.tax_rate || 5}
                  onChange={(e) =>
                    handleChange("tax_rate", parseFloat(e.target.value) || 0)
                  }
                  placeholder="5"
                  step="0.01"
                  disabled={!can("admin")}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Applied to all orders (e.g., 5 for 5% GST)
                </p>
              </div>

              <div>
                <Label htmlFor="discount_type">Default Discount Type</Label>
                <select
                  id="discount_type"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.discount_type || "fixed"}
                  onChange={(e) =>
                    handleChange("discount_type", e.target.value)
                  }
                  disabled={!can("admin")}
                >
                  <option value="fixed">Fixed Amount</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="font-semibold">Tax Information</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tax_id">Tax ID / GST Number</Label>
                  <Input
                    id="tax_id"
                    className="mt-2"
                    value={formData.tax_id || ""}
                    onChange={(e) => handleChange("tax_id", e.target.value)}
                    placeholder="e.g., 27AABFU5055K1Z0"
                    disabled={!can("admin")}
                  />
                </div>
                <div>
                  <Label htmlFor="registration_number">
                    Registration Number
                  </Label>
                  <Input
                    id="registration_number"
                    className="mt-2"
                    value={formData.registration_number || ""}
                    onChange={(e) =>
                      handleChange("registration_number", e.target.value)
                    }
                    placeholder="Business registration number"
                    disabled={!can("admin")}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Localization Settings */}
          <TabsContent value="localization" className="space-y-6 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="currency">Currency</Label>
                <select
                  id="currency"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.currency || "INR"}
                  onChange={(e) => handleChange("currency", e.target.value)}
                  disabled={!can("admin")}
                >
                  <option value="INR">₹ Indian Rupee (INR)</option>
                  <option value="USD">$ US Dollar (USD)</option>
                  <option value="EUR">€ Euro (EUR)</option>
                  <option value="GBP">£ British Pound (GBP)</option>
                </select>
              </div>

              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.timezone || "Asia/Kolkata"}
                  onChange={(e) => handleChange("timezone", e.target.value)}
                  disabled={!can("admin")}
                >
                  <option value="Asia/Kolkata">India (IST)</option>
                  <option value="America/New_York">Eastern (EST/EDT)</option>
                  <option value="America/Chicago">Central (CST/CDT)</option>
                  <option value="America/Los_Angeles">
                    Pacific (PST/PDT)
                  </option>
                  <option value="Europe/London">London (GMT/BST)</option>
                  <option value="Europe/Paris">Central Europe (CET/CEST)</option>
                </select>
              </div>

              <div>
                <Label htmlFor="date_format">Date Format</Label>
                <select
                  id="date_format"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.date_format || "DD-MM-YYYY"}
                  onChange={(e) => handleChange("date_format", e.target.value)}
                  disabled={!can("admin")}
                >
                  <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                  <option value="MM-DD-YYYY">MM-DD-YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>

              <div>
                <Label htmlFor="language">Language</Label>
                <select
                  id="language"
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.language || "en"}
                  onChange={(e) => handleChange("language", e.target.value)}
                  disabled={!can("admin")}
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                </select>
              </div>
            </div>
          </TabsContent>

          {/* Advanced Settings */}
          <TabsContent value="advanced" className="space-y-6 p-6">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="font-semibold">Order Settings</h3>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Low Stock Alert Threshold</Label>
                    <p className="text-xs text-muted-foreground">
                      Alert when stock falls below this amount
                    </p>
                  </div>
                  <Input
                    type="number"
                    className="mt-2 w-32"
                    value={formData.low_stock_threshold || 10}
                    onChange={(e) =>
                      handleChange(
                        "low_stock_threshold",
                        parseInt(e.target.value) || 0
                      )
                    }
                    placeholder="10"
                    disabled={!can("admin")}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="font-semibold">Notification Settings</h3>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enable_email_notifications || false}
                    onChange={(e) =>
                      handleChange(
                        "enable_email_notifications",
                        e.target.checked
                      )
                    }
                    disabled={!can("admin")}
                    className="rounded border-input"
                  />
                  <span className="text-sm">Enable Email Notifications</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enable_sms_notifications || false}
                    onChange={(e) =>
                      handleChange("enable_sms_notifications", e.target.checked)
                    }
                    disabled={!can("admin")}
                    className="rounded border-input"
                  />
                  <span className="text-sm">Enable SMS Notifications</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.enable_low_stock_alerts || true}
                    onChange={(e) =>
                      handleChange(
                        "enable_low_stock_alerts",
                        e.target.checked
                      )
                    }
                    disabled={!can("admin")}
                    className="rounded border-input"
                  />
                  <span className="text-sm">Enable Low Stock Alerts</span>
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="font-semibold">API Settings</h3>
              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="whatsapp_api_key">WhatsApp API Key</Label>
                  <Input
                    id="whatsapp_api_key"
                    className="mt-2"
                    type="password"
                    value={formData.whatsapp_api_key || ""}
                    onChange={(e) =>
                      handleChange("whatsapp_api_key", e.target.value)
                    }
                    placeholder="Your WhatsApp Business API key"
                    disabled={!can("admin")}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    For WhatsApp order integration
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Access Control Tab */}
          <TabsContent value="access" className="space-y-6 p-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">Role-Based Access Control</h3>
              <p className="text-sm text-muted-foreground mb-6">
                The following roles determine what each user can access in the system:
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(ROLE_PERMISSIONS).map(([role, info]) => (
                <div key={role} className="rounded-lg border border-border p-4 bg-card">
                  <div className="mb-3">
                    <StatusBadge value={role} />
                  </div>
                  <p className="text-sm font-semibold mb-3">{info.desc}</p>

                  <div className="mb-3">
                    <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2">Can Access:</p>
                    <ul className="text-xs space-y-1">
                      {info.access.map((access) => (
                        <li key={access} className="text-green-700 dark:text-green-300">✓ {access}</li>
                      ))}
                    </ul>
                  </div>

                  {info.restrictions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">Restrictions:</p>
                      <ul className="text-xs space-y-1">
                        {info.restrictions.map((restriction) => (
                          <li key={restriction} className="text-red-700 dark:text-red-300">✗ {restriction}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

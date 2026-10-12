import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  calculateTotals,
  channelOf,
  createOrder,
  fetchCustomers,
  fetchProducts,
  type Product,
} from "@/lib/data";
import { formatCurrency } from "@/lib/format";
import { useRole } from "@/components/role-provider";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "Counter Sale — ibird" },
      {
        name: "description",
        content:
          "Bill in-store customers at the counter: search or scan products, apply discounts and take cash, card or UPI payments.",
      },
      { property: "og:title", content: "Counter Sale — ibird" },
      {
        property: "og:description",
        content: "Fast counter billing with live stock, discounts and instant order records.",
      },
    ],
  }),
  component: CounterSale,
});

function CounterSale() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [customerId, setCustomerId] = useState("walkin");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [payment, setPayment] = useState("cash");
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");

  const canSell = can("edit");

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.active && channelOf(p) === "counter")
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ?? "").includes(q),
      )
      .slice(0, 24);
  }, [products, search]);

  const { subtotal, discount: safeDiscount, tax, total } = calculateTotals(cart, discount);

  const add = (product: Product) =>
    setCart((prev) => {
      const found = prev.find((i) => i.product.id === product.id);
      const inCart = found?.quantity ?? 0;
      if (inCart + 1 > product.stock) {
        toast.error(`Only ${product.stock} of ${product.name} in stock`);
        return prev;
      }
      if (found)
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      return [...prev, { product, quantity: 1 }];
    });

  const setQty = (id: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product.id !== id) return i;
          const next = i.quantity + delta;
          if (next > i.product.stock) {
            toast.error(`Only ${i.product.stock} of ${i.product.name} in stock`);
            return i;
          }
          return { ...i, quantity: next };
        })
        .filter((i) => i.quantity > 0),
    );

  const checkout = useMutation({
    mutationFn: () => {
      const customer = customers.find((c) => c.id === customerId);
      const selectedName =
        customerId !== "walkin" ? customer?.name : customerName.trim() || "Walk-in customer";
      const selectedPhone = customerId !== "walkin" ? customer?.phone : customerPhone.trim();

      return createOrder({
        customer_id: customerId !== "walkin" ? (customer?.id ?? null) : null,
        customer_name: selectedName ?? "Walk-in customer",
        customer_phone: selectedPhone || null,
        source: "counter",
        status: "pending",
        payment_method: payment,
        payment_status: "paid",
        notes: notes || null,
        delivery_address: deliveryAddress || null,
        special_instructions: specialInstructions || null,
        items: cart,
        discount: safeDiscount,
      });
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(`Sale ${order.order_number} recorded`);
      setCart([]);
      setDiscount(0);
      setNotes("");
      setCustomerId("walkin");
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setSpecialInstructions("");
      navigate({ to: "/orders/$orderId", params: { orderId: order.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Counter Sale" subtitle="Bill customers who buy at the counter.">
      {!canSell && (
        <div className="mb-4 rounded-lg border border-border bg-secondary p-3 text-sm">
          Your role can view this screen but cannot record sales.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-5 lg:col-span-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Search by name, SKU or scan barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((p) => {
              const out = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  disabled={out || !canSell}
                  className="rounded-xl border border-border p-3 text-left transition-colors hover:border-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.sku} · {out ? "Out of stock" : `${p.stock} in stock`} · GST {Number(p.gst ?? 0)}%
                  </p>
                  <p className="mt-2 font-bold text-primary">{formatCurrency(p.price)}</p>
                </button>
              );
            })}
            {!results.length && (
              <p className="text-sm text-muted-foreground">
                No counter products found. Add them in Inventory under "Counter sale products".
              </p>
            )}
          </div>
        </div>

        <div className="card-surface flex flex-col p-5">
          <h2 className="text-lg font-bold">Cart</h2>
          <div className="mt-3 flex-1 space-y-3">
            {cart.map((i) => (
              <div key={i.product.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{i.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(Number(i.product.price) * i.quantity)}
                  </p>
                </div>
                <Button size="icon" variant="outline" onClick={() => setQty(i.product.id, -1)}>
                  <Minus className="size-3" />
                </Button>
                <span className="w-6 text-center text-sm font-semibold">{i.quantity}</span>
                <Button size="icon" variant="outline" onClick={() => setQty(i.product.id, 1)}>
                  <Plus className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setCart((p) => p.filter((x) => x.product.id !== i.product.id))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
            {!cart.length && <p className="text-sm text-muted-foreground">Cart is empty.</p>}
          </div>

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div>
              <Label>Customer</Label>
              <Select
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v);
                  if (v !== "walkin") {
                    const c = customers.find((x) => x.id === v);
                    if (c) {
                      setCustomerName(c.name);
                      setCustomerPhone(c.phone || "");
                    }
                  } else {
                    setCustomerName("");
                    setCustomerPhone("");
                  }
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walkin">Walk-in customer</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {customerId === "walkin" && (
              <>
                <div>
                  <Label>Customer name (optional)</Label>
                  <Input
                    className="mt-1"
                    placeholder="Enter customer name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Phone number (optional)</Label>
                  <Input
                    className="mt-1"
                    inputMode="tel"
                    placeholder="Saves the customer, and links repeat purchases"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <Label>Address (optional, if the order is delivered)</Label>
              <Textarea
                className="mt-1"
                rows={2}
                placeholder="Delivery address"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </div>

            <div>
              <Label>Special instructions</Label>
              <Textarea
                className="mt-1"
                rows={2}
                placeholder="Gift wrap, customisation or other requests"
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
              />
            </div>

            <div>
              <Label>Payment method</Label>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Discount</Label>
              <Input
                type="number"
                min={0}
                className="mt-1"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
              />
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-medium text-foreground">{formatCurrency(subtotal)}</span>
              </div>
              {safeDiscount > 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span className="font-medium text-foreground">- {formatCurrency(safeDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Tax (GST per product)</span>
                <span className="font-medium text-foreground">{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-foreground">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={!cart.length || checkout.isPending || !canSell}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? "Recording sale..." : "Complete sale"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

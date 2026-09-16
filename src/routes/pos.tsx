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
import { createOrder, fetchCustomers, fetchProducts, type Product } from "@/lib/data";
import { formatCurrency } from "@/lib/format";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "New Order — ibird Point of Sale" },
      {
        name: "description",
        content:
          "Create manual ibird orders at the counter: scan or search products, apply discounts and take cash, card or UPI payments.",
      },
      { property: "og:title", content: "New Order — ibird Point of Sale" },
      {
        property: "og:description",
        content: "Fast counter billing with live stock, discounts and instant receipts.",
      },
    ],
  }),
  component: POS,
});

function POS() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ?? "").includes(q),
      )
      .slice(0, 24);
  }, [products, search]);

  const subtotal = cart.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
  const tax = Math.round((subtotal - discount) * 0.05 * 100) / 100;
  const total = Math.max(0, subtotal - discount + tax);

  const add = (product: Product) =>
    setCart((prev) => {
      const found = prev.find((i) => i.product.id === product.id);
      if (found)
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      return [...prev, { product, quantity: 1 }];
    });

  const setQty = (id: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((i) => (i.product.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    );

  const checkout = useMutation({
    mutationFn: () => {
      const customer = customers.find((c) => c.id === customerId);
      const selectedName = customerId !== "walkin" ? customer?.name : customerName || "Walk-in customer";
      const selectedPhone = customerId !== "walkin" ? customer?.phone : customerPhone;

      return createOrder({
        customer_id: customerId !== "walkin" ? customer?.id : null,
        customer_name: selectedName,
        customer_phone: selectedPhone || null,
        source: "manual",
        status: "pending",
        payment_method: payment,
        payment_status: "paid",
        notes: notes || null,
        delivery_address: deliveryAddress || null,
        special_instructions: specialInstructions || null,
        items: cart,
        discount,
      });
    },
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(`Order ${order.order_number} created`);
      setCart([]);
      setDiscount(0);
      setNotes("");
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setSpecialInstructions("");
      navigate({ to: "/orders/$orderId", params: { orderId: order.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Point of Sale" subtitle="Create and bill a manual order.">
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
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p)}
                className="rounded-xl border border-border p-3 text-left transition-colors hover:border-primary hover:bg-secondary"
              >
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.sku} · {p.stock} in stock
                </p>
                <p className="mt-2 font-bold text-primary">{formatCurrency(p.price)}</p>
              </button>
            ))}
            {!results.length && <p className="text-sm text-muted-foreground">No products found.</p>}
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
              <Select value={customerId} onValueChange={(v) => {
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
              }}>
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
                  <Label>Customer name</Label>
                  <Input
                    className="mt-1"
                    placeholder="Enter customer name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Phone number</Label>
                  <Input
                    className="mt-1"
                    placeholder="Customer phone (for WhatsApp orders)"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <Label>Delivery address</Label>
              <Textarea
                className="mt-1"
                rows={2}
                placeholder="Enter delivery address (required for WhatsApp orders)"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </div>

            <div>
              <Label>Special instructions</Label>
              <Textarea
                className="mt-1"
                rows={2}
                placeholder="Any special cooking instructions or customization requests"
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
              <div className="flex justify-between">
                <span>Tax (5%)</span>
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
              disabled={!cart.length || checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              Complete sale
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

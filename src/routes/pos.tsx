import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Image as ImageIcon,
  Keyboard,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  calculateTotals,
  channelOf,
  createOrder,
  createOrLinkCustomer,
  fetchCustomers,
  fetchProducts,
  type Customer,
  type Product,
} from "@/lib/data";
import {
  addToPosCart,
  deleteHeldBill,
  holdCurrentBill,
  resetDraft,
  resumeHeldBill,
  updateDraft,
  usePosStore,
  type PosDraft,
} from "@/lib/pos-store";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useRole } from "@/components/role-provider";
import { InvoiceViewer } from "@/components/invoice-viewer";
import { ensureInvoice, type Invoice } from "@/lib/documents";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "Counter Sale — ibird" },
      {
        name: "description",
        content:
          "Bill in-store customers at the counter: scan or search products, hold bills, apply discounts and take cash, card or UPI payments.",
      },
      { property: "og:title", content: "Counter Sale — ibird" },
      {
        property: "og:description",
        content: "Fast counter billing with barcode scanning, held bills, shortcuts and live stock.",
      },
    ],
  }),
  component: CounterSale,
});

const SHORTCUTS: [string, string][] = [
  ["F2", "Search / scan product"],
  ["F3", "Customer details"],
  ["F4", "Hold current bill"],
  ["F7", "Open held bills"],
  ["F8", "Discount"],
  ["F9 or Ctrl + Enter", "Complete sale"],
  ["Esc", "Clear search"],
];

const PAYMENT_METHODS: [string, string][] = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["upi", "UPI"],
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function discountAmountOf(draft: PosDraft, subtotal: number) {
  const value = Math.max(0, Number(draft.discountValue) || 0);
  const amount = draft.discountType === "percent" ? (subtotal * Math.min(value, 100)) / 100 : value;
  return round2(Math.min(amount, subtotal));
}

function CounterSale() {
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { draft, held } = usePosStore();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const [search, setSearch] = useState("");
  const [showHeld, setShowHeld] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  const [cartInView, setCartInView] = useState(false);

  useEffect(() => {
    const el = cartRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCartInView(Boolean(entry?.isIntersecting)), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const canSell = can("edit");

  const counterProducts = useMemo(
    () => products.filter((p) => p.active && channelOf(p) === "counter"),
    [products],
  );

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return counterProducts
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ?? "").toLowerCase().includes(q),
      )
      .slice(0, 24);
  }, [counterProducts, search]);

  // Held bills keep the product as it was; always bill at today's price, GST and stock.
  const liveCart = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return draft.cart.map((l) => ({ ...l, product: byId.get(l.product.id) ?? l.product }));
  }, [draft.cart, products]);

  const subtotalOnly = liveCart.reduce((s, l) => s + Number(l.product.price) * l.quantity, 0);
  const discountAmount = discountAmountOf(draft, subtotalOnly);
  const { subtotal, tax, total } = calculateTotals(liveCart, discountAmount);

  const add = useCallback(
    (product: Product) => {
      const result = addToPosCart(product);
      if (!result.ok) toast.error(result.message);
    },
    [],
  );

  const setQty = (id: string, delta: number) =>
    updateDraft((d) => ({
      cart: d.cart
        .map((l) => {
          if (l.product.id !== id) return l;
          const live = products.find((p) => p.id === id) ?? l.product;
          const next = l.quantity + delta;
          if (next > live.stock) {
            toast.error(`Only ${live.stock} of ${live.name} in stock`);
            return l;
          }
          return { ...l, quantity: next };
        })
        .filter((l) => l.quantity > 0),
    }));

  // Enter in the search box: an exact barcode/SKU (what a scanner types) or a single match is added.
  const addFromSearch = () => {
    const q = search.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const exact =
      counterProducts.find((p) => (p.barcode ?? "").toLowerCase() === lower) ??
      counterProducts.find((p) => p.sku.toLowerCase() === lower);
    const pick = exact ?? (results.length === 1 ? results[0] : undefined);
    if (!pick) {
      toast.error(`No single product matches "${q}"`);
      return;
    }
    if (pick.stock <= 0) {
      toast.error(`${pick.name} is out of stock`);
      return;
    }
    add(pick);
    setSearch("");
  };

  const hold = useCallback(() => {
    const bill = holdCurrentBill();
    if (!bill) {
      toast.error("Nothing to hold. The bill is empty.");
      return;
    }
    toast.success(`Bill held as "${bill.label}"`);
    setSearch("");
    searchRef.current?.focus();
  }, []);

  const resume = (id: string) => {
    const { resumed, heldCurrent } = resumeHeldBill(id);
    if (!resumed) return;
    toast.success(
      heldCurrent ? `Resumed "${resumed.label}". The open bill was held.` : `Resumed "${resumed.label}"`,
    );
    setShowHeld(false);
  };

  const [saleInvoice, setSaleInvoice] = useState<Invoice | null>(null);

  const checkout = useMutation({
    mutationFn: () => {
      const customer = customers.find((c) => c.id === draft.customerId);
      const isWalkIn = draft.customerId === "walkin";
      const selectedName = isWalkIn ? draft.customerName.trim() || "Walk-in customer" : customer?.name;
      const selectedPhone = isWalkIn ? draft.customerPhone.trim() : customer?.phone;

      return createOrder({
        customer_id: isWalkIn ? null : (customer?.id ?? null),
        customer_name: selectedName ?? "Walk-in customer",
        customer_phone: selectedPhone || null,
        source: "counter",
        // Paid and handed over at the till, so the sale is complete (counter sales are not in Orders)
        status: "completed",
        payment_method: draft.payment,
        payment_status: "paid",
        notes: draft.notes || null,
        delivery_address: draft.deliveryAddress || null,
        special_instructions: draft.specialInstructions || null,
        items: liveCart,
        discount: discountAmount,
      });
    },
    onSuccess: async (order) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      resetDraft();
      setSearch("");
      // Show the invoice to print or download; the next bill can start as soon as it is closed
      try {
        const invoice = await ensureInvoice(order.id);
        toast.success(`Sale recorded · invoice ${invoice.invoice_number}`);
        setSaleInvoice(invoice);
      } catch {
        toast.success(`Sale ${order.order_number} recorded`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canComplete = canSell && liveCart.length > 0 && !checkout.isPending;

  const itemCount = liveCart.reduce((s, l) => s + l.quantity, 0);
  const selectedCustomer = customers.find((c) => c.id === draft.customerId);
  const customerLabel =
    draft.customerId === "walkin"
      ? draft.customerName.trim() || "Walk-in customer"
      : (selectedCustomer?.name ?? draft.customerName) || "Customer";
  const customerPhoneLabel =
    draft.customerId === "walkin" ? draft.customerPhone.trim() : (selectedCustomer?.phone ?? draft.customerPhone);
  const hasExtraDetails = Boolean(draft.deliveryAddress || draft.specialInstructions || draft.notes);

  // Keyboard shortcuts for fast counter work
  const latest = useRef({ hold, canComplete, complete: () => checkout.mutate() });
  latest.current = { hold, canComplete, complete: () => checkout.mutate() };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { hold, canComplete, complete } = latest.current;
      const key = e.key;
      if (key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (key === "F3") {
        e.preventDefault();
        setShowCustomer(true);
      } else if (key === "F4") {
        e.preventDefault();
        hold();
      } else if (key === "F7") {
        e.preventDefault();
        setShowHeld(true);
      } else if (key === "F8") {
        e.preventDefault();
        discountRef.current?.focus();
        discountRef.current?.select();
      } else if (key === "F9" || (key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (canComplete) complete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AppShell
      title="Counter Sale"
      subtitle="Bill customers who buy at the counter."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setShowHeld(true)} title="Held bills (F7)">
            <Play className="size-4" />
            <span className="hidden sm:inline">Held bills</span> ({held.length})
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden sm:inline-flex"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts"
          >
            <Keyboard className="size-4" />
          </Button>
        </div>
      }
    >
      {!canSell && (
        <div className="mb-4 rounded-lg border border-border bg-secondary p-3 text-sm">
          Your role can view this screen but cannot record sales.
        </div>
      )}
      <div className="grid gap-4 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:pb-0">
        <div className="card-surface min-w-0 p-4 sm:p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              autoFocus
              className="pl-9"
              placeholder="Scan barcode or search by name / SKU  (F2)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  if (canSell) addFromSearch();
                } else if (e.key === "Escape") {
                  setSearch("");
                }
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Tip: you can scan a barcode from any page. The product is added to this bill automatically.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
            {results.map((p) => {
              const out = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  disabled={out || !canSell}
                  className="flex min-w-0 flex-col rounded-xl border border-border p-2.5 text-left transition-colors hover:border-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 sm:p-3"
                >
                  <ProductThumb product={p} className="mb-2 size-12" />
                  <p className="line-clamp-2 break-words text-sm font-semibold leading-snug">{p.name}</p>
                  {p.variant && <p className="truncate text-xs text-muted-foreground">{p.variant}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {out ? "Out of stock" : `${p.stock} in stock`} · GST {Number(p.gst ?? 0)}%
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{p.sku}</p>
                  <p className="mt-auto pt-1.5 font-bold text-primary">{formatCurrency(p.price)}</p>
                </button>
              );
            })}
            {!results.length && (
              <p className="col-span-2 text-sm text-muted-foreground xl:col-span-3">
                No counter products found. Add them in Inventory under "Counter sale products".
              </p>
            )}
          </div>
        </div>

        <div
          ref={cartRef}
          className="card-surface flex scroll-mt-4 flex-col p-4 sm:p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Cart{itemCount ? ` (${itemCount})` : ""}</h2>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={!liveCart.length}
              onClick={hold}
              title="Hold this bill (F4)"
            >
              <Pause className="size-3.5" /> Hold (F4)
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setShowCustomer(true)}
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
            title="Customer details (F3)"
          >
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{customerLabel}</span>
              {customerPhoneLabel && <span className="text-muted-foreground"> · {customerPhoneLabel}</span>}
              {hasExtraDetails && <span className="text-muted-foreground"> · details added</span>}
            </span>
            <span className="shrink-0 text-xs font-semibold text-primary">Change (F3)</span>
          </button>

          {/* Only the item list scrolls, so the totals and Complete sale stay in view */}
          <div className="mt-3 min-h-[96px] flex-1 space-y-2 overflow-y-auto pr-1">
            {liveCart.map((i) => (
              <div key={i.product.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start gap-2">
                  <ProductThumb product={i.product} className="size-9" />
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug">
                    {i.product.name}
                    {i.product.variant && (
                      <span className="font-normal text-muted-foreground"> · {i.product.variant}</span>
                    )}
                  </p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() => updateDraft((d) => ({ cart: d.cart.filter((x) => x.product.id !== i.product.id) }))}
                    title="Remove"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatCurrency(Number(i.product.price) * i.quantity)} · GST {Number(i.product.gst ?? 0)}%
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="outline" className="size-7" onClick={() => setQty(i.product.id, -1)}>
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-7 text-center text-sm font-semibold">{i.quantity}</span>
                    <Button size="icon" variant="outline" className="size-7" onClick={() => setQty(i.product.id, 1)}>
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!liveCart.length && <p className="text-sm text-muted-foreground">Cart is empty. Scan or pick a product.</p>}
          </div>

          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1" role="group" aria-label="Payment method">
              {PAYMENT_METHODS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateDraft({ payment: value })}
                  aria-pressed={draft.payment === value}
                  className={`rounded px-2 py-1.5 text-sm font-semibold transition-colors ${
                    draft.payment === value ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Label className="shrink-0 text-sm">Discount</Label>
              <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
                {(["amount", "percent"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateDraft({ discountType: t })}
                    className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                      draft.discountType === t ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                    }`}
                    aria-pressed={draft.discountType === t}
                  >
                    {t === "amount" ? "₹" : "%"}
                  </button>
                ))}
              </div>
              <Input
                ref={discountRef}
                type="number"
                min={0}
                max={draft.discountType === "percent" ? 100 : undefined}
                step="any"
                className="h-9"
                value={draft.discountValue === 0 ? "" : draft.discountValue}
                placeholder={draft.discountType === "percent" ? "% (F8)" : "₹ (F8)"}
                onChange={(e) => updateDraft({ discountValue: Number(e.target.value) || 0 })}
              />
            </div>

            <div className="space-y-1 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>
                  Subtotal ({itemCount} item{itemCount === 1 ? "" : "s"})
                </span>
                <span className="font-medium text-foreground">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between">
                  <span>
                    Discount{draft.discountType === "percent" ? ` (${Math.min(Number(draft.discountValue) || 0, 100)}%)` : ""}
                  </span>
                  <span className="font-medium text-foreground">- {formatCurrency(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>GST (per product)</span>
                <span className="font-medium text-foreground">{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 text-lg font-bold text-foreground">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
            <Button className="w-full" size="lg" disabled={!canComplete} onClick={() => checkout.mutate()}>
              {checkout.isPending ? "Recording sale..." : `Complete sale · ${formatCurrency(total)} (F9)`}
            </Button>
          </div>
        </div>
      </div>

      {/* Phones: the cart sits below the products, so keep the bill total in view and jump to it */}
      {liveCart.length > 0 && !cartInView && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {itemCount} item{itemCount === 1 ? "" : "s"} · GST {formatCurrency(tax)}
              </p>
              <p className="text-lg font-bold leading-tight">{formatCurrency(total)}</p>
            </div>
            <Button onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              View cart
            </Button>
          </div>
        </div>
      )}

      <CustomerDialog open={showCustomer} onOpenChange={setShowCustomer} customers={customers} />
      <InvoiceViewer
        invoice={saleInvoice}
        onClose={() => {
          setSaleInvoice(null);
          searchRef.current?.focus();
        }}
      />

      <Dialog open={showHeld} onOpenChange={setShowHeld}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Held bills</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {!held.length && <p className="text-sm text-muted-foreground">No bills on hold. Press F4 to hold one.</p>}
            {held.map((b) => {
              const items = b.draft.cart.reduce((s, l) => s + l.quantity, 0);
              const sub = b.draft.cart.reduce((s, l) => s + Number(l.product.price) * l.quantity, 0);
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {items} item(s) · {formatCurrency(sub)} before tax · held {formatDateTime(b.heldAt)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => resume(b.id)}>
                    Resume
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete held bill "${b.label}"?`)) deleteHeldBill(b.id);
                    }}
                    title="Delete held bill"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                <span>{action}</span>
                <kbd className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-xs">{keys}</kbd>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Barcode scanning works on any page: the product is added to the open bill and Counter Sale opens.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// Customer search (name or phone), walk-in details, address, instructions and notes in one popup.
function CustomerDialog({
  open,
  onOpenChange,
  customers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
}) {
  const { draft } = usePosStore();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = digitsOf(query);
    if (!q) return customers.slice(0, 50);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && digitsOf(c.phone).includes(digits)))
      .slice(0, 50);
  }, [customers, query]);

  const choose = (c: Customer | null) => {
    if (!c) updateDraft({ customerId: "walkin", customerName: "", customerPhone: "" });
    else updateDraft({ customerId: c.id, customerName: c.name, customerPhone: c.phone ?? "" });
  };

  const isWalkIn = draft.customerId === "walkin";

  // A full phone number (10 digits, optionally with 91) that no customer has
  const queryDigits = digitsOf(query);
  const phoneKey = queryDigits.slice(-10);
  const looksLikePhone = /^[\d\s+()-]+$/.test(query.trim()) && (queryDigits.length === 10 || (queryDigits.length === 12 && queryDigits.startsWith("91")));
  const newPhone =
    looksLikePhone && !customers.some((c) => digitsOf(c.phone).slice(-10) === phoneKey) ? phoneKey : "";

  const [newName, setNewName] = useState("");
  useEffect(() => setNewName(""), [newPhone]);

  const queryClient = useQueryClient();
  const createCustomer = useMutation({
    mutationFn: async () => {
      const id = await createOrLinkCustomer({ name: newName.trim(), phone: newPhone });
      if (!id) throw new Error("Could not create the customer");
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      updateDraft({ customerId: id, customerName: newName.trim(), customerPhone: newPhone });
      toast.success(`Customer ${newName.trim()} created and selected`);
      setQuery("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customer details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Customer</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9"
                placeholder="Search by name or phone number"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim() && matches[0]) {
                    e.preventDefault();
                    choose(matches[0]);
                    setQuery("");
                  }
                }}
              />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
              <CustomerOption
                selected={isWalkIn}
                name="Walk-in customer"
                phone="No customer record"
                onSelect={() => choose(null)}
              />
              {matches.map((c) => (
                <CustomerOption
                  key={c.id}
                  selected={draft.customerId === c.id}
                  name={c.name}
                  phone={c.phone || "No phone"}
                  onSelect={() => choose(c)}
                />
              ))}
              {query.trim() && !matches.length && !newPhone && (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {queryDigits.length >= 3
                    ? "No customer with this number. Enter the full 10-digit phone number to create one."
                    : "No customer found. Search by phone number to create a new customer."}
                </p>
              )}
            </div>

            {/* Phone number not on file: offer to create the customer right here */}
            {newPhone && (
              <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-semibold">
                  No customer with <span className="font-mono">{newPhone}</span>. Create a new customer?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    className="min-w-0 flex-1 basis-40"
                    placeholder="Customer name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newName.trim()) {
                        e.preventDefault();
                        createCustomer.mutate();
                      }
                    }}
                  />
                  <Button
                    className="gap-1.5"
                    disabled={!newName.trim() || createCustomer.isPending}
                    onClick={() => createCustomer.mutate()}
                  >
                    <UserPlus className="size-4" /> {createCustomer.isPending ? "Creating…" : "Create customer"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {isWalkIn && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Name (optional)</Label>
                <Input
                  className="mt-1"
                  placeholder="Customer name"
                  value={draft.customerName}
                  onChange={(e) => updateDraft({ customerName: e.target.value })}
                />
              </div>
              <div>
                <Label>Phone (optional)</Label>
                <Input
                  className="mt-1"
                  inputMode="tel"
                  placeholder="Saves the customer"
                  value={draft.customerPhone}
                  onChange={(e) => updateDraft({ customerPhone: e.target.value })}
                />
              </div>
            </div>
          )}

          <div>
            <Label>Address (optional, if the order is delivered)</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder="Delivery address"
              value={draft.deliveryAddress}
              onChange={(e) => updateDraft({ deliveryAddress: e.target.value })}
            />
          </div>
          <div>
            <Label>Special instructions</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder="Gift wrap, customisation or other requests"
              value={draft.specialInstructions}
              onChange={(e) => updateDraft({ specialInstructions: e.target.value })}
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea className="mt-1" rows={2} value={draft.notes} onChange={(e) => updateDraft({ notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerOption({
  selected,
  name,
  phone,
  onSelect,
}: {
  selected: boolean;
  name: string;
  phone: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 ${
        selected ? "bg-primary/10" : "hover:bg-secondary"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{phone}</span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

// Small product photo, same style as the Inventory list; placeholder icon when there is no photo.
function ProductThumb({ product, className }: { product: Product; className: string }) {
  return product.image_url ? (
    <img
      src={product.image_url}
      alt={product.name}
      loading="lazy"
      className={`${className} shrink-0 rounded border border-border bg-muted object-cover`}
    />
  ) : (
    <div className={`${className} flex shrink-0 items-center justify-center rounded bg-muted`}>
      <ImageIcon className="size-1/2 text-muted-foreground" />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  IndianRupee,
  Package,
  Search,
  Plus,
  Edit2,
  Trash2,
  Image as ImageIcon,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ExportMenu } from "@/components/export-menu";
import { StatCard } from "@/components/stat-card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  adjustStock,
  fetchProducts,
  fetchStockMovements,
  fetchCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  createCategory,
  updateCategory,
  deleteCategory,
  channelOf,
  sellsAtCounter,
  sellsOnline,
  type Product,
  type Category,
  type SalesChannel,
} from "@/lib/data";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { useRole } from "@/components/role-provider";

const INVENTORY_TABS = ["online", "counter", "categories", "alerts", "history"];

export const Route = createFileRoute("/inventory")({
  // ?tab=alerts opens a tab directly (used by stock notifications)
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search["tab"] === "string" && INVENTORY_TABS.includes(search["tab"]) ? { tab: search["tab"] } : {},
  head: () => ({
    meta: [
      { title: "Inventory — ibird Stock Tracking & Alerts" },
      {
        name: "description",
        content:
          "Real-time ibird stock levels, SKU and barcode management, low-stock alerts and full stock movement history.",
      },
      { property: "og:title", content: "Inventory — ibird Stock Tracking & Alerts" },
      {
        property: "og:description",
        content: "Adjust stock for damages and returns, and review historical inventory movements.",
      },
    ],
  }),
  component: InventoryPage,
});

type ProductFormData = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  variant: string;
  cost_price: number;
  price: number;
  stock: number;
  low_stock_threshold: number;
  hsn_code: string;
  gst: number;
  sales_channel: SalesChannel;
  giveaway_coupon: boolean;
  active: boolean;
  image_url?: string;
};

const CHANNEL_LABEL: Record<SalesChannel, string> = {
  online: "WhatsApp / online",
  counter: "Counter sale",
  both: "WhatsApp + counter",
};

// Two ticks in the form map to one channel value: online, counter or both (one shared stock)
const channelFromTicks = (online: boolean, counter: boolean): SalesChannel =>
  online && counter ? "both" : counter ? "counter" : "online";

function InventoryPage() {
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: movements = [] } = useQuery({
    queryKey: ["stock-movements"],
    queryFn: fetchStockMovements,
  });
  const { data: dbCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const { tab: tabFromUrl } = Route.useSearch();
  const [tab, setTab] = useState<string>(tabFromUrl ?? "online");
  useEffect(() => {
    if (tabFromUrl) setTab(tabFromUrl);
  }, [tabFromUrl]);
  const tabChannel: SalesChannel = tab === "counter" ? "counter" : "online";
  const [target, setTarget] = useState<Product | null>(null);
  const [qty, setQty] = useState(0);
  const [type, setType] = useState("adjustment");
  const [note, setNote] = useState("");

  // Product management states
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDesc, setNewCategoryDesc] = useState("");
  const [formData, setFormData] = useState<ProductFormData>({
    name: "",
    sku: "",
    barcode: "",
    category: "Cookware",
    variant: "",
    cost_price: 0,
    price: 0,
    stock: 0,
    low_stock_threshold: 0,
    hsn_code: "",
    gst: 5,
    sales_channel: "online",
    giveaway_coupon: false,
    active: true,
  });
  const [selectedImage, setSelectedImage] = useState<File | null>(null);

  // Combine database categories with product categories
  const categories = useMemo(() => {
    const dbCategoryNames = dbCategories.map((c) => c.name);
    const productCategories = Array.from(new Set(products.map((p) => p.category)));
    const combined = Array.from(new Set([...dbCategoryNames, ...productCategories]));
    return combined.sort();
  }, [dbCategories, products]);

  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    if (category !== "all" && p.category !== category) return false;
    if (status !== "all" && (status === "active") !== (p.active !== false)) return false;
    return true;
  });
  const inactiveCount = products.filter((p) => p.active === false).length;

  // Quick on/off from the list. Inactive products leave Counter Sale, barcode scanning and the
  // WhatsApp catalogue; their stock and sales history stay.
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateProduct(id, { active }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(`${p.name}${p.variant ? ` ${p.variant}` : ""} is now ${p.active ? "active" : "inactive"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lowStock = products.filter((p) => p.active !== false && p.stock <= p.low_stock_threshold);
  const stockValue = products.reduce((s, p) => s + Number(p.cost_price) * p.stock, 0);
  const units = products.reduce((s, p) => s + p.stock, 0);

  const adjust = useMutation({
    mutationFn: () => adjustStock(target!, qty, type, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("Stock adjusted");
      setTarget(null);
      setQty(0);
      setNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProduct = useMutation({
    mutationFn: async () => {
      let imageUrl = formData.image_url;

      const productData = {
        ...formData,
        cost_price: Number(formData.cost_price),
        price: Number(formData.price),
        stock: Number(formData.stock),
        low_stock_threshold: Number(formData.low_stock_threshold),
        image_url: imageUrl,
        active: formData.active,
      };

      let savedProduct;
      if (editingProduct) {
        await updateProduct(editingProduct.id, productData);
        savedProduct = { ...editingProduct, ...productData };
      } else {
        savedProduct = await createProduct(productData);
      }

      // Upload image after product is created/updated
      if (selectedImage) {
        const uploadedUrl = await uploadProductImage(selectedImage, savedProduct.id);
        if (uploadedUrl) {
          // Update product with image URL
          await updateProduct(savedProduct.id, { image_url: uploadedUrl });
        }
      }

      return savedProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(editingProduct ? "Product updated" : "Product created");
      setShowProductDialog(false);
      resetProductForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveCategory = useMutation({
    mutationFn: async () => {
      if (editingCategory) {
        return updateCategory(editingCategory.id, newCategoryName, newCategoryDesc);
      } else {
        return createCategory(newCategoryName, newCategoryDesc);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(editingCategory ? "Category updated" : "Category created");
      setShowCategoryDialog(false);
      setNewCategoryName("");
      setNewCategoryDesc("");
      setEditingCategory(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetProductForm = () => {
    setFormData({
      name: "",
      sku: "",
      barcode: "",
      category: "Cookware",
      variant: "",
      cost_price: 0,
      price: 0,
      stock: 0,
      low_stock_threshold: 0,
      hsn_code: "",
      gst: 5,
      sales_channel: tabChannel,
      giveaway_coupon: false,
      active: true,
    });
    setSelectedImage(null);
    setEditingProduct(null);
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || "",
      category: product.category,
      variant: product.variant || "",
      cost_price: Number(product.cost_price),
      price: Number(product.price),
      stock: product.stock,
      low_stock_threshold: product.low_stock_threshold,
      hsn_code: product.hsn_code || "",
      gst: Number(product.gst ?? 5),
      sales_channel: channelOf(product),
      giveaway_coupon: Boolean(product.giveaway_coupon),
      active: product.active !== false,
      ...(product.image_url ? { image_url: product.image_url } : {}),
    });
    setShowProductDialog(true);
  };

  const renderProducts = (channel: SalesChannel) => (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {channel === "online"
              ? "Shown to customers in the WhatsApp catalogue. Products marked Both are also sold at the counter from the same stock."
              : "Sold at the counter. Products marked Both are also on WhatsApp and share the same stock."}
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search product or SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active products</SelectItem>
                <SelectItem value="inactive">Inactive products{inactiveCount ? ` (${inactiveCount})` : ""}</SelectItem>
                <SelectItem value="all">All products</SelectItem>
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Image</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU / Barcode</TableHead>
                  <TableHead>HSN / GST</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.filter((p) => (channel === "online" ? sellsOnline(p) : sellsAtCounter(p))).map((p) => (
                  <TableRow key={p.id} className={p.active === false ? "opacity-60" : undefined}>
                    <TableCell>
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                          <ImageIcon className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {p.name}
                      {p.variant && (
                        <span className="ml-1 text-xs text-muted-foreground">({p.variant})</span>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {channelOf(p) === "both" && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Both · one stock
                          </span>
                        )}
                        {p.giveaway_coupon && (
                          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            🎁 Offer coupon
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.sku}
                      <br />
                      <span className="text-xs">{p.barcode}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.hsn_code && <div className="text-muted-foreground">HSN: {p.hsn_code}</div>}
                      <div className="text-muted-foreground">GST: {Number(p.gst ?? 0)}%</div>
                    </TableCell>
                    <TableCell>{p.category}</TableCell>
                    <TableCell>
                      <label className="flex w-fit cursor-pointer items-center gap-2" title="Inactive products are hidden from Counter Sale and WhatsApp">
                        <Switch
                          checked={p.active !== false}
                          disabled={!can("edit") || setActive.isPending}
                          onCheckedChange={(v) => setActive.mutate({ id: p.id, active: v })}
                          aria-label={p.active !== false ? "Deactivate product" : "Activate product"}
                        />
                        <span className={`text-xs font-semibold ${p.active !== false ? "text-success" : "text-muted-foreground"}`}>
                          {p.active !== false ? "Active" : "Inactive"}
                        </span>
                      </label>
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        p.stock <= p.low_stock_threshold ? "text-destructive" : ""
                      }`}
                    >
                      {p.stock}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(p.price)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {can("edit") && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditProduct(p)}
                              title="Edit product"
                            >
                              <Edit2 className="size-3" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setTarget(p)} title="Adjust stock">
                              Adjust
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deleteProductMutation.mutate(p.id)}
                              title="Delete product"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
  );

  return (
    <AppShell
      title="Inventory"
      subtitle="Real-time stock tracking, alerts and adjustments."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCategoryDialog(true)}>
            + Category
          </Button>
          <Button onClick={() => { resetProductForm(); setShowProductDialog(true); }}>
            <Plus className="size-4 mr-1" /> Product
          </Button>
          <ExportMenu
            filename="ibird-inventory"
            title="Inventory"
            rows={filtered.map((p) => ({
              Product: p.name,
              SKU: p.sku,
              Barcode: p.barcode ?? "",
              Channel: CHANNEL_LABEL[channelOf(p)],
              HSN: p.hsn_code ?? "",
              Category: p.category,
              Variant: p.variant ?? "",
              Stock: p.stock,
              Threshold: p.low_stock_threshold,
              Cost: Number(p.cost_price),
              Price: Number(p.price),
              GST: Number(p.gst ?? 0),
              "Offer coupon": p.giveaway_coupon ? "Yes" : "No",
              Status: p.active !== false ? "Active" : "Inactive",
            }))}
          />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Products"
          value={formatNumber(products.length - inactiveCount)}
          hint={inactiveCount ? `Active SKUs · ${inactiveCount} inactive` : "Active SKUs"}
          icon={Package}
        />
        <StatCard
          label="Units in stock"
          value={formatNumber(units)}
          hint="All warehouses"
          icon={Boxes}
          tone="brand"
        />
        <StatCard
          label="Stock value"
          value={formatCurrency(stockValue)}
          hint="At cost"
          icon={IndianRupee}
          tone="success"
        />
        <StatCard
          label="Low stock"
          value={formatNumber(lowStock.length)}
          hint="At or below threshold"
          icon={AlertTriangle}
          tone="warning"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="online">WhatsApp / online products</TabsTrigger>
          <TabsTrigger value="counter">Counter sale products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="alerts">Low stock alerts</TabsTrigger>
          <TabsTrigger value="history">Movement history</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="card-surface mt-4 p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold">Product Categories</h3>
              <p className="text-sm text-muted-foreground">Manage product categories for your inventory</p>
            </div>
            {can("edit") && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingCategory(null);
                  setNewCategoryName("");
                  setNewCategoryDesc("");
                  setShowCategoryDialog(true);
                }}
              >
                <Plus className="size-4 mr-1" /> Add Category
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dbCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categories yet. Add one to get started.</p>
            ) : (
              dbCategories.map((cat) => (
                <div key={cat.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold">{cat.name}</p>
                      {cat.description && (
                        <p className="text-xs text-muted-foreground mt-1">{cat.description}</p>
                      )}
                    </div>
                  </div>
                  {can("edit") && (
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingCategory(cat);
                          setNewCategoryName(cat.name);
                          setNewCategoryDesc(cat.description || "");
                          setShowCategoryDialog(true);
                        }}
                      >
                        <Edit2 className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => deleteCategoryMutation.mutate(cat.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="online" className="card-surface mt-4 p-4">
          {renderProducts("online")}
        </TabsContent>

        <TabsContent value="counter" className="card-surface mt-4 p-4">
          {renderProducts("counter")}
        </TabsContent>

        <TabsContent value="alerts" className="card-surface mt-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lowStock.map((p) => (
              <div key={p.id} className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {CHANNEL_LABEL[channelOf(p)]} · {p.stock} left · reorder below {p.low_stock_threshold}
                </p>
                {can("edit") && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setTarget(p)}>
                    Restock
                  </Button>
                )}
              </div>
            ))}
            {!lowStock.length && <p className="text-sm text-muted-foreground">All stock healthy.</p>}
          </div>
        </TabsContent>

        <TabsContent value="history" className="card-surface mt-4 p-4">
          <div className="flex justify-end">
            <ExportMenu
              filename="ibird-stock-movements"
              title="Stock movements"
              rows={movements.map((m) => ({
                Product: m.product_name,
                Type: m.movement_type,
                Quantity: m.quantity,
                Note: m.note ?? "",
                Date: formatDateTime(m.created_at),
              }))}
            />
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.slice(0, 100).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.product_name}</TableCell>
                    <TableCell className="capitalize">{m.movement_type}</TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        m.quantity < 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.note}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Stock Adjustment Dialog */}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock — {target?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Movement type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="restock">Restock</SelectItem>
                  <SelectItem value="damage">Damaged</SelectItem>
                  <SelectItem value="return">Customer return</SelectItem>
                  <SelectItem value="adjustment">Manual adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantity (negative to reduce)</Label>
              <Input
                type="number"
                className="mt-1"
                value={qty}
                onChange={(e) => setQty(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label>Note</Label>
              <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button disabled={!qty || adjust.isPending} onClick={() => adjust.mutate()}>
              Save adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog open={showProductDialog} onOpenChange={setShowProductDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Product" : "Add New Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Product Name *</Label>
                <Input
                  className="mt-1"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Stainless Steel Frying Pan"
                />
              </div>
              <div>
                <Label>SKU *</Label>
                <Input
                  className="mt-1"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  placeholder="e.g. CW-FP-001"
                />
              </div>
            </div>

            <div>
              <Label>Sold through *</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["online", "WhatsApp / online", "Shown in the WhatsApp catalogue"],
                    ["counter", "Counter sale", "Shown in Counter Sale"],
                  ] as const
                ).map(([key, label, hint]) => {
                  const online = sellsOnline(formData);
                  const counter = sellsAtCounter(formData);
                  const checked = key === "online" ? online : counter;
                  return (
                    <label
                      key={key}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 hover:bg-secondary"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={(v) => {
                          const next = v === true;
                          // At least one channel stays ticked
                          const o = key === "online" ? next : online;
                          const c = key === "counter" ? next : counter;
                          if (!o && !c) return;
                          setFormData({ ...formData, sales_channel: channelFromTicks(o, c) });
                        }}
                      />
                      <span>
                        <span className="block text-sm font-medium">{label}</span>
                        <span className="block text-xs text-muted-foreground">{hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {formData.sales_channel === "both" && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Sold on WhatsApp and at the counter from one stock count.
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border p-3">
              <span>
                <span className="block text-sm font-semibold">Active</span>
                <span className="block text-xs text-muted-foreground">
                  Inactive products are hidden from Counter Sale, barcode scanning and the WhatsApp catalogue.
                  Stock and sales history are kept.
                </span>
              </span>
              <Switch
                checked={formData.active}
                onCheckedChange={(v) => setFormData({ ...formData, active: v })}
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <span>
                <span className="block text-sm font-semibold">🎁 Thar ROXX offer product</span>
                <span className="block text-xs text-muted-foreground">
                  Gives one giveaway coupon for every unit sold, on WhatsApp and at the counter.
                </span>
              </span>
              <Switch
                checked={formData.giveaway_coupon}
                onCheckedChange={(v) => setFormData({ ...formData, giveaway_coupon: v })}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Barcode</Label>
                <Input
                  className="mt-1"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>HSN Code</Label>
                <Input
                  className="mt-1"
                  value={formData.hsn_code}
                  onChange={(e) => setFormData({ ...formData, hsn_code: e.target.value })}
                  placeholder="e.g. 7310"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Variant</Label>
                <Input
                  className="mt-1"
                  value={formData.variant}
                  onChange={(e) => setFormData({ ...formData, variant: e.target.value })}
                  placeholder="e.g. Black / Large"
                />
              </div>
              <div>
                <Label>GST Rate (%) *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="mt-1"
                  value={formData.gst === 0 ? "" : formData.gst}
                  onChange={(e) => setFormData({ ...formData, gst: e.target.value === "" ? 0 : Number(e.target.value) || 0 })}
                  placeholder="e.g. 5, 12, 18"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category *</Label>
                <Select value={formData.category} onValueChange={(val) => setFormData({ ...formData, category: val })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cost Price (₹) *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="mt-1"
                  value={formData.cost_price === 0 ? "" : formData.cost_price}
                  onChange={(e) => setFormData({ ...formData, cost_price: e.target.value === "" ? 0 : Number(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Selling Price (₹) *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="mt-1"
                  value={formData.price === 0 ? "" : formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value === "" ? 0 : Number(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Stock Quantity *</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  className="mt-1"
                  value={formData.stock === 0 ? "" : formData.stock}
                  onChange={(e) => setFormData({ ...formData, stock: e.target.value === "" ? 0 : Number(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
            </div>

            <div>
              <Label>Low Stock Threshold *</Label>
              <Input
                type="text"
                inputMode="numeric"
                className="mt-1"
                value={formData.low_stock_threshold === 0 ? "" : formData.low_stock_threshold}
                onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value === "" ? 0 : Number(e.target.value) || 0 })}
                placeholder="Alert when stock below this"
              />
            </div>

            <div>
              <Label>Product Image</Label>
              <div className="mt-3 space-y-3">
                {formData.image_url && !selectedImage && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Current Image:</p>
                    <img src={formData.image_url} alt={formData.name} className="h-32 w-32 rounded object-cover border" />
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">{selectedImage ? "New Image:" : "Upload Image:"}</p>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setSelectedImage(e.target.files?.[0] || null)}
                  />
                  {selectedImage && (
                    <div className="mt-2">
                      <p className="text-sm text-success">✓ {selectedImage.name}</p>
                      <img
                        src={URL.createObjectURL(selectedImage)}
                        alt="Preview"
                        className="mt-2 h-32 w-32 rounded object-cover border"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowProductDialog(false); resetProductForm(); }}>
              Cancel
            </Button>
            <Button
              disabled={!formData.name || !formData.sku || !formData.category || saveProduct.isPending}
              onClick={() => saveProduct.mutate()}
            >
              {editingProduct ? "Update Product" : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "Add New Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Category Name *</Label>
              <Input
                className="mt-1"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Cookware, Accessories"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                className="mt-1"
                value={newCategoryDesc}
                onChange={(e) => setNewCategoryDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCategoryDialog(false);
                setNewCategoryName("");
                setNewCategoryDesc("");
                setEditingCategory(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!newCategoryName || saveCategory.isPending}
              onClick={() => saveCategory.mutate()}
            >
              {editingCategory ? "Update Category" : "Add Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

import { supabase } from "@/integrations/supabase/client";

export type Order = {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string | null;
  source: string;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  refund_amount: number;
  notes: string | null;
  delivery_address?: string | null;
  special_instructions?: string | null;
  assigned_to?: string | null;
  assigned_at?: string | null;
  assigned_by?: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  variant: string | null;
  cost_price: number;
  price: number;
  stock: number;
  low_stock_threshold: number;
  hsn_code?: string | null;
  gst?: number;
  active: boolean;
  image_url?: string | null;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  customer_type: string;
  notes: string | null;
  created_at: string;
};

export type Employee = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  department: string | null;
  salary: number;
  status: string;
  join_date: string;
  password?: string;
};

export type OrderStatusHistory = {
  id: string;
  order_id: string;
  old_status: string | null;
  new_status: string;
  changed_at: string;
  changed_by: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderAssignmentHistory = {
  id: string;
  order_id: string;
  old_assigned_to: string | null;
  new_assigned_to: string | null;
  assigned_at: string;
  assigned_by: string | null;
  notes: string | null;
  created_at: string;
};

export type StockMovement = {
  id: string;
  product_id: string | null;
  product_name: string;
  movement_type: string;
  quantity: number;
  note: string | null;
  created_at: string;
};

const db = supabase as unknown as {
  from: (table: string) => any;
};

export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await db
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchOrder(id: string): Promise<{ order: Order; items: OrderItem[] }> {
  const { data, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  const { data: items, error: itemsError } = await db
    .from("order_items")
    .select("*")
    .eq("order_id", id);
  if (itemsError) throw itemsError;
  return { order: data as Order, items: (items ?? []) as OrderItem[] };
}

export async function fetchOrderItems(): Promise<OrderItem[]> {
  const { data, error } = await db.from("order_items").select("*");
  if (error) throw error;
  return (data ?? []) as OrderItem[];
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await db.from("products").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await db.from("categories").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function createCategory(name: string, description?: string): Promise<Category> {
  const { data, error } = await db
    .from("categories")
    .insert({ name, description: description || null })
    .select("*")
    .single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(id: string, name: string, description?: string): Promise<Category> {
  const { data, error } = await db
    .from("categories")
    .update({ name, description: description || null })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Category;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await db.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await db
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Customer[];
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await db.from("employees").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export async function fetchStockMovements(): Promise<StockMovement[]> {
  const { data, error } = await db
    .from("stock_movements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as StockMovement[];
}

export async function updateOrderStatus(ids: string[], patch: Record<string, unknown>) {
  const { error } = await db.from("orders").update(patch).in("id", ids);
  if (error) throw error;
}

export async function deleteOrders(ids: string[]) {
  const { error } = await db.from("orders").delete().in("id", ids);
  if (error) throw error;
}

export async function createOrLinkCustomer(customerData: {
  name: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  email?: string | null;
}): Promise<string | null> {
  // If no phone, can't link or create
  if (!customerData.phone) return null;

  // Try to find existing customer by phone
  const { data: existing } = await db
    .from("customers")
    .select("id")
    .eq("phone", customerData.phone)
    .maybeSingle();

  if (existing) return existing.id;

  // Create new customer
  const { data: newCustomer, error } = await db
    .from("customers")
    .insert({
      name: customerData.name,
      phone: customerData.phone,
      email: customerData.email || null,
      city: customerData.city || null,
      state: customerData.state || null,
      customer_type: "retail",
    })
    .select("id")
    .single();

  if (error) {
    console.warn("Failed to create customer:", error);
    return null;
  }

  return newCustomer?.id || null;
}

export async function createOrder(payload: {
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string | null;
  source: string;
  payment_method: string;
  payment_status: string;
  status: string;
  notes: string | null;
  delivery_address?: string | null;
  special_instructions?: string | null;
  items: { product: Product; quantity: number }[];
  discount: number;
}) {
  const subtotal = payload.items.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
  const tax = Math.round((subtotal - payload.discount) * 0.05 * 100) / 100;
  const total = subtotal - payload.discount + tax;

  // Generate order number: IB-YYYYMMSS (IB-202601, IB-202602, etc.)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const yearMonth = `${year}${month}`;

  // Count orders in current month to get serial number
  const monthStart = new Date(year, now.getMonth(), 1);
  const monthEnd = new Date(year, now.getMonth() + 1, 1);
  const { data: monthOrders = [] } = await db
    .from("orders")
    .select("id")
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString());

  const serialNumber = ((monthOrders.length) + 1).toString().padStart(2, '0');
  const orderNumber = `IB-${yearMonth}${serialNumber}`;

  // Try to create or link customer if phone is provided
  let customerId = payload.customer_id;
  if (!customerId && payload.customer_phone) {
    customerId = await createOrLinkCustomer({
      name: payload.customer_name,
      phone: payload.customer_phone,
    });
  }

  const { data, error } = await db
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_id: customerId,
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone || null,
      source: payload.source,
      status: payload.status,
      payment_method: payload.payment_method,
      payment_status: payload.payment_status,
      subtotal,
      discount: payload.discount,
      tax,
      total,
      notes: payload.notes,
      delivery_address: payload.delivery_address || null,
      special_instructions: payload.special_instructions || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  const order = data as Order;

  const items = payload.items.map((i) => ({
    order_id: order.id,
    product_id: i.product.id,
    product_name: i.product.name,
    sku: i.product.sku,
    quantity: i.quantity,
    unit_price: i.product.price,
    line_total: Number(i.product.price) * i.quantity,
  }));
  const { error: itemsError } = await db.from("order_items").insert(items);
  if (itemsError) throw itemsError;

  for (const i of payload.items) {
    await db
      .from("products")
      .update({ stock: Math.max(0, i.product.stock - i.quantity) })
      .eq("id", i.product.id);
    await db.from("stock_movements").insert({
      product_id: i.product.id,
      product_name: i.product.name,
      movement_type: "sale",
      quantity: -i.quantity,
      note: `Order ${orderNumber}`,
    });
  }
  return order;
}

export async function adjustStock(product: Product, quantity: number, type: string, note: string) {
  const { error } = await db
    .from("products")
    .update({ stock: Math.max(0, product.stock + quantity) })
    .eq("id", product.id);
  if (error) throw error;
  await db.from("stock_movements").insert({
    product_id: product.id,
    product_name: product.name,
    movement_type: type,
    quantity,
    note,
  });
}

export async function upsertRecord(table: string, values: Record<string, unknown>, id?: string) {
  if (id) {
    const { error } = await db.from(table).update(values).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await db.from(table).insert(values);
    if (error) throw error;
  }
}

export async function deleteRecord(table: string, id: string) {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw error;
}

// Product management functions
export async function createProduct(product: Omit<Product, 'id' | 'created_at'>) {
  const { data, error } = await db
    .from("products")
    .insert(product)
    .select("*")
    .single();
  if (error) throw error;
  return data as Product;
}

export async function updateProduct(id: string, updates: Partial<Product>) {
  const { data, error } = await db
    .from("products")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string) {
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw error;
}

// Image upload function
export async function uploadProductImage(file: File, productId: string): Promise<string> {
  try {
    console.log("Starting image upload for product:", productId, "File:", file.name);

    const timestamp = Date.now();
    const filename = `product-${productId}-${timestamp}.${file.name.split('.').pop()}`;
    console.log("Generated filename:", filename);

    const { data, error } = await supabase.storage
      .from("product-images")
      .upload(filename, file, { upsert: true });

    if (error) {
      console.error("Image upload error:", error);
      console.error("Error message:", error.message);
      console.error("Error status:", error.status);
      // Return empty string if upload fails - continue without image
      return "";
    }

    console.log("Upload successful, data:", data);

    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(filename);

    console.log("Public URL:", urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error("Image upload exception:", error);
    // Continue without throwing - allow product to be saved without image
    return "";
  }
}

export type Settings = {
  id?: string;
  company_name?: string;
  company_email?: string;
  company_phone?: string;
  company_website?: string;
  company_address?: string;
  company_description?: string;
  tax_rate?: number;
  tax_id?: string;
  registration_number?: string;
  currency?: string;
  timezone?: string;
  date_format?: string;
  language?: string;
  low_stock_threshold?: number;
  enable_email_notifications?: boolean;
  enable_sms_notifications?: boolean;
  enable_low_stock_alerts?: boolean;
  whatsapp_api_key?: string;
  discount_type?: string;
  created_at?: string;
  updated_at?: string;
};

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await db
    .from("settings")
    .select("*")
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found, which is fine for settings
    throw error;
  }

  // Return default settings if no record exists
  return data || {
    tax_rate: 5,
    currency: "INR",
    timezone: "Asia/Kolkata",
    date_format: "DD-MM-YYYY",
    language: "en",
    low_stock_threshold: 10,
    enable_low_stock_alerts: true,
    discount_type: "fixed",
  };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  // Check if settings record exists
  const { data: existing } = await db
    .from("settings")
    .select("id")
    .single();

  if (existing) {
    // Update existing settings
    const { data, error } = await db
      .from("settings")
      .update(settings)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return data as Settings;
  } else {
    // Create new settings record
    const { data, error } = await db
      .from("settings")
      .insert(settings)
      .select("*")
      .single();

    if (error) throw error;
    return data as Settings;
  }
}

// Order assignment functions
export async function assignOrders(orderIds: string[], employeeId: string, assignedById: string): Promise<void> {
  const { error } = await db
    .from("orders")
    .update({
      assigned_to: employeeId,
      assigned_at: new Date().toISOString(),
      assigned_by: assignedById,
    })
    .in("id", orderIds);
  if (error) throw error;
}

export async function unassignOrders(orderIds: string[]): Promise<void> {
  const { error } = await db
    .from("orders")
    .update({
      assigned_to: null,
      assigned_at: null,
      assigned_by: null,
    })
    .in("id", orderIds);
  if (error) throw error;
}

// Order history functions
export async function recordStatusChange(
  orderId: string,
  oldStatus: string | null,
  newStatus: string,
  changedBy: string | null,
  notes?: string
): Promise<void> {
  const { error } = await db
    .from("order_status_history")
    .insert({
      order_id: orderId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      notes: notes || null,
      changed_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function recordAssignmentChange(
  orderId: string,
  oldAssignedTo: string | null,
  newAssignedTo: string | null,
  assignedBy: string | null,
  notes?: string
): Promise<void> {
  const { error } = await db
    .from("order_assignment_history")
    .insert({
      order_id: orderId,
      old_assigned_to: oldAssignedTo,
      new_assigned_to: newAssignedTo,
      assigned_by: assignedBy,
      notes: notes || null,
      assigned_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function fetchOrderStatusHistory(orderId: string): Promise<OrderStatusHistory[]> {
  const { data, error } = await db
    .from("order_status_history")
    .select("*")
    .eq("order_id", orderId)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OrderStatusHistory[];
}

export async function fetchOrderAssignmentHistory(orderId: string): Promise<OrderAssignmentHistory[]> {
  const { data, error } = await db
    .from("order_assignment_history")
    .select("*")
    .eq("order_id", orderId)
    .order("assigned_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OrderAssignmentHistory[];
}

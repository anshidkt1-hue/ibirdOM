import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../server';
import { createPaymentLink } from './razorpayService';

export interface CartItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CustomerInput {
  name?: string;
  address?: string;
  instructions?: string;
}

const GENERIC_NAMES = new Set(['', 'customer', 'whatsapp customer', 'valued customer']);

// "919745988637", "+91 97459 88637" and "09745988637" are the same person: compare the last 10 digits.
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

async function findCustomerByKey(key: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, address')
    .eq('phone_key', key)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Customer lookup failed: ${error.message}`);
  return data;
}

async function findOrCreateCustomer(
  phoneNumber: string,
  name: string,
  address?: string
): Promise<string> {
  const key = phoneKey(phoneNumber);
  let existing = await findCustomerByKey(key);

  if (!existing) {
    const { data: created, error } = await supabase
      .from('customers')
      .insert({ name, phone: phoneNumber, address: address || null, customer_type: 'new' })
      .select('id')
      .single();

    if (!error && created) return created.id;

    // Lost a race with a concurrent order from the same number: use the row that won.
    existing = await findCustomerByKey(key);
    if (!existing) throw new Error(`Customer create failed: ${error?.message}`);
  }

  // Returning customer: never create another record; refresh the details they gave us.
  const patch: Record<string, string> = {};
  if (address && address !== existing.address) patch.address = address;
  if (GENERIC_NAMES.has((existing.name || '').trim().toLowerCase()) && !GENERIC_NAMES.has(name.trim().toLowerCase())) {
    patch.name = name;
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('customers').update(patch).eq('id', existing.id);
    if (error) console.error('⚠️ Customer update failed:', error.message);
  }

  return existing.id;
}

// Sequence-backed number is collision-free under concurrent checkouts; the random
// fallback keeps orders flowing if the database function is not installed yet.
async function nextOrderNumber(): Promise<string> {
  const { data, error } = await supabase.rpc('next_whatsapp_order_number');
  if (!error && typeof data === 'string' && data) return data;
  console.error('⚠️ next_whatsapp_order_number unavailable, using fallback:', error?.message);
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `WA-${stamp}-${rand}`;
}

export async function createWhatsAppOrder(
  phoneNumber: string,
  cartItems: CartItem[],
  customer: CustomerInput = {}
) {
  const name = customer.name || 'WhatsApp Customer';

  const customerId = await findOrCreateCustomer(phoneNumber, name, customer.address);

  // GST is per product, read from Inventory at checkout time
  const { data: rates, error: ratesError } = await supabase
    .from('products')
    .select('id, gst')
    .in('id', cartItems.map((i) => i.product_id));
  if (ratesError) throw new Error(`Tax lookup failed: ${ratesError.message}`);
  const rateOf = new Map((rates || []).map((r: any) => [r.id, Number(r.gst ?? 0)]));

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const lines = cartItems.map((i) => {
    const lineTotal = round2(i.price * i.quantity);
    const taxRate = rateOf.get(i.product_id) ?? 0;
    return { ...i, lineTotal, taxRate, taxAmount: round2((lineTotal * taxRate) / 100) };
  });
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const tax = round2(lines.reduce((sum, l) => sum + l.taxAmount, 0));
  const total = round2(subtotal + tax);

  const orderId = uuidv4();
  const orderNumber = await nextOrderNumber();

  const { error: orderError } = await supabase.from('orders').insert({
    id: orderId,
    order_number: orderNumber,
    customer_id: customerId,
    customer_name: name,
    customer_phone: phoneNumber,
    source: 'whatsapp',
    status: 'pending',
    payment_method: 'razorpay',
    payment_status: 'unpaid',
    subtotal,
    tax,
    total,
    delivery_address: customer.address || '',
    special_instructions: customer.instructions || '',
  });
  if (orderError) throw new Error(`Order create failed: ${orderError.message}`);

  const itemRows = lines.map((l) => ({
    order_id: orderId,
    product_id: l.product_id,
    product_name: l.name,
    quantity: l.quantity,
    unit_price: l.price,
    line_total: l.lineTotal,
    tax_rate: l.taxRate,
    tax_amount: l.taxAmount,
  }));
  let { error: itemsError } = await supabase.from('order_items').insert(itemRows);
  if (itemsError && /tax_(rate|amount)/.test(itemsError.message)) {
    // Tax columns not migrated yet: keep the order rather than fail checkout
    ({ error: itemsError } = await supabase
      .from('order_items')
      .insert(itemRows.map(({ tax_rate, tax_amount, ...rest }) => rest)));
  }
  if (itemsError) throw new Error(`Order items failed: ${itemsError.message}`);

  await supabase.from('order_status_history').insert({
    order_id: orderId,
    old_status: null,
    new_status: 'pending',
    notes: 'Order placed via WhatsApp',
  });

  const { error: linkError } = await supabase.from('whatsapp_orders').insert({
    order_id: orderId,
    phone_number: phoneNumber,
    payment_status: 'pending',
  });
  if (linkError) throw new Error(`WhatsApp order link failed: ${linkError.message}`);

  const paymentLink = await createPaymentLink(orderId, {
    order_number: orderNumber,
    customer_name: name,
    customer_phone: phoneNumber,
    amount: total,
  });

  return { orderId, orderNumber, subtotal, tax, total, paymentUrl: paymentLink.short_url as string };
}

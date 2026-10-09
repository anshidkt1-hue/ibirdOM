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

export async function createWhatsAppOrder(
  phoneNumber: string,
  cartItems: CartItem[],
  customer: CustomerInput = {}
) {
  const name = customer.name || 'WhatsApp Customer';

  let customerId: string | null = null;
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phoneNumber)
    .limit(1)
    .maybeSingle();

  if (existing) {
    customerId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from('customers')
      .insert({ name, phone: phoneNumber, customer_type: 'new' })
      .select('id')
      .single();
    if (error) throw new Error(`Customer create failed: ${error.message}`);
    customerId = created.id;
  }

  const subtotal = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const orderId = uuidv4();
  const orderNumber = `WA-${Date.now().toString().slice(-8)}`;

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

  const { error: itemsError } = await supabase.from('order_items').insert(
    cartItems.map((i) => ({
      order_id: orderId,
      product_id: i.product_id,
      product_name: i.name,
      quantity: i.quantity,
      unit_price: i.price,
      line_total: i.price * i.quantity,
    }))
  );
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

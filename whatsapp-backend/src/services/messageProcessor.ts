import { supabase } from '../server';
import { sendButtons, sendProductList, sendTextMessage } from './whatsappService';
import { createWhatsAppOrder, CartItem } from './orderService';

const RESET_WORDS = ['hi', 'hello', 'hey', 'menu', 'start', 'restart', 'cancel', 'order'];

async function updateSession(phoneNumber: string, patch: Record<string, any>) {
  const { error } = await supabase
    .from('whatsapp_sessions')
    .update({ ...patch, updated_at: new Date() })
    .eq('phone_number', phoneNumber);
  if (error) console.error('❌ Session update failed:', error.message);
}

async function getSession(phoneNumber: string) {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();
  return data;
}

function cartSummary(cart: CartItem[]) {
  const lines = cart.map((i) => `• ${i.name} x${i.quantity} — ₹${i.price * i.quantity}`);
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  return `🛒 *Your cart*\n${lines.join('\n')}\n\nSubtotal: ₹${subtotal}`;
}

export async function sendWelcome(phoneNumber: string) {
  await updateSession(phoneNumber, { session_state: 'welcome', cart_items: [], form_data: {} });
  await sendButtons(
    phoneNumber,
    '👋 Welcome to *ibird*!\n\nBrowse our products and place your order right here on WhatsApp.',
    [{ id: 'start_order', title: '🛒 Start Order' }]
  );
}

async function startOrder(phoneNumber: string) {
  await updateSession(phoneNumber, { session_state: 'ask_name', cart_items: [], form_data: {} });
  await sendTextMessage(phoneNumber, "Great! Let's get your order started.\n\nWhat's your *name*?");
}

async function checkout(phoneNumber: string) {
  const session = await getSession(phoneNumber);
  const cart: CartItem[] = session?.cart_items || [];

  if (cart.length === 0) {
    await sendTextMessage(phoneNumber, 'Your cart is empty. Pick a product first 👇');
    await sendProductList(phoneNumber);
    return;
  }

  try {
    const form = session?.form_data || {};
    const order = await createWhatsAppOrder(phoneNumber, cart, {
      name: form.name,
      address: form.address,
    });

    await updateSession(phoneNumber, { session_state: 'payment' });
    await sendTextMessage(
      phoneNumber,
      `✅ Order *${order.orderNumber}* created!\n\n` +
        `Subtotal: ₹${order.subtotal}\nTax (5%): ₹${order.tax}\n*Total: ₹${order.total}*\n\n` +
        `💳 Pay securely here:\n${order.paymentUrl}\n\n` +
        `Your order is confirmed once payment is received. Link valid for 24 hours.`
    );
  } catch (error: any) {
    console.error('❌ Checkout failed:', error.message);
    await sendTextMessage(phoneNumber, '😕 Sorry, we could not create your order. Please try again in a moment.');
  }
}

export async function processCustomerMessage(phoneNumber: string, messageText: string, session: any) {
  const raw = messageText.trim();
  const text = raw.toLowerCase();
  const state = session?.session_state || 'welcome';

  console.log(`📨 Processing message from ${phoneNumber}: "${raw}" (state: ${state})`);

  if (RESET_WORDS.includes(text) || state === 'welcome' || state === 'completed') {
    return sendWelcome(phoneNumber);
  }

  if (state === 'ask_name') {
    const form = { ...(session.form_data || {}), name: raw.slice(0, 80) };
    await updateSession(phoneNumber, { form_data: form, session_state: 'ask_address' });
    return sendTextMessage(phoneNumber, `Thanks ${form.name}! 🏠 Please send your *delivery address*.`);
  }

  if (state === 'ask_address') {
    const form = { ...(session.form_data || {}), address: raw.slice(0, 300) };
    await updateSession(phoneNumber, { form_data: form, session_state: 'catalog' });
    await sendTextMessage(phoneNumber, 'Got it! Here are our products 👇');
    return sendProductList(phoneNumber);
  }

  if (state === 'catalog') {
    if (text.includes('checkout') || text.includes('pay')) return checkout(phoneNumber);
    return sendProductList(phoneNumber);
  }

  if (state === 'payment') {
    const { data: wa } = await supabase
      .from('whatsapp_orders')
      .select('payment_link, payment_status')
      .eq('phone_number', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (wa?.payment_status === 'pending' && wa.payment_link) {
      return sendTextMessage(phoneNumber, `💳 Your payment is still pending:\n${wa.payment_link}\n\nSend *menu* to start a new order.`);
    }
    return sendWelcome(phoneNumber);
  }

  return sendWelcome(phoneNumber);
}

export async function processButtonReply(phoneNumber: string, buttonId: string) {
  console.log(`🔘 Button clicked - ${phoneNumber}: ${buttonId}`);

  if (buttonId === 'start_order') return startOrder(phoneNumber);

  if (buttonId === 'add_more') {
    await updateSession(phoneNumber, { session_state: 'catalog' });
    return sendProductList(phoneNumber);
  }

  if (buttonId === 'checkout') return checkout(phoneNumber);

  if (buttonId === 'clear_cart') {
    await updateSession(phoneNumber, { cart_items: [], session_state: 'catalog' });
    await sendTextMessage(phoneNumber, 'Cart cleared 🗑️');
    return sendProductList(phoneNumber);
  }
}

export async function processListSelection(phoneNumber: string, productId: string) {
  console.log(`🛒 Product selected - ${phoneNumber}: ${productId}`);

  const { data: product } = await supabase
    .from('products')
    .select('id, name, price, stock')
    .eq('id', productId)
    .maybeSingle();

  if (!product) {
    return sendTextMessage(phoneNumber, 'Sorry, that product is no longer available.');
  }

  const session = await getSession(phoneNumber);
  const cart: CartItem[] = session?.cart_items || [];
  const existing = cart.find((i) => i.product_id === product.id);

  if (existing) {
    if (existing.quantity >= product.stock) {
      await sendTextMessage(phoneNumber, `Only ${product.stock} of ${product.name} in stock.`);
    } else {
      existing.quantity += 1;
    }
  } else {
    cart.push({
      product_id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity: 1,
    });
  }

  await updateSession(phoneNumber, { cart_items: cart, session_state: 'catalog' });

  await sendButtons(phoneNumber, `${cartSummary(cart)}\n\nWhat next?`, [
    { id: 'add_more', title: '➕ Add more' },
    { id: 'checkout', title: '✅ Checkout' },
    { id: 'clear_cart', title: '🗑️ Clear cart' },
  ]);
}

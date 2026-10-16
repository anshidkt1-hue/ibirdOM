import { supabase } from '../server';
import { sendButtons, sendProductCard, sendProductList, sendTextMessage, STORE_NAME } from './whatsappService';
import { createWhatsAppOrder, CartItem } from './orderService';
import { answer, classify, handoff, isBotPaused, resumeBot, sendFaqMenu } from './enquiryService';

// The welcome is not sent again if a greeting arrives within this window
const WELCOME_COOLDOWN_MS = 3 * 60_000;

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

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

// Same per-line GST rounding as createWhatsAppOrder, so the summary matches the payment amount
function cartSummary(cart: CartItem[]) {
  const lines = cart.map((i) => {
    const line = round2(i.price * i.quantity);
    return `• ${i.name} × ${i.quantity} — ${inr(line)} (GST ${i.gst ?? 0}%)`;
  });
  const subtotal = round2(cart.reduce((s, i) => s + round2(i.price * i.quantity), 0));
  const gst = round2(cart.reduce((s, i) => s + round2((round2(i.price * i.quantity) * (i.gst ?? 0)) / 100), 0));
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  return (
    `🛒 *Your cart* (${count} item${count === 1 ? '' : 's'})\n${lines.join('\n')}\n\n` +
    `Subtotal: ${inr(subtotal)}\nGST: ${inr(gst)}\n*Total: ${inr(round2(subtotal + gst))}*`
  );
}

// The name and address in form_data are kept between orders, so returning customers only confirm them
export async function sendWelcome(phoneNumber: string) {
  await updateSession(phoneNumber, { session_state: 'welcome', cart_items: [], last_welcome_at: new Date() });
  await sendButtons(
    phoneNumber,
    `👋 Welcome to *${STORE_NAME}*!\n\nOrder right here on WhatsApp, ask us anything, or talk to our team.`,
    [
      { id: 'start_order', title: '🛒 Start order' },
      { id: 'ask_question', title: '💬 Ask a question' },
      { id: 'talk_to_us', title: '📞 Talk to us' },
    ]
  );
}

// Products first; the name and address are collected at checkout, just before payment
async function startOrder(phoneNumber: string) {
  await updateSession(phoneNumber, { session_state: 'catalog', cart_items: [] });
  await sendProductList(phoneNumber);
}

// Checkout: ask for the details that are missing, or let a returning customer confirm the saved ones
async function beginCheckout(phoneNumber: string) {
  const session = await getSession(phoneNumber);
  const cart: CartItem[] = session?.cart_items || [];
  if (session?.session_state === 'processing') return;

  if (cart.length === 0) {
    await updateSession(phoneNumber, { session_state: 'catalog' });
    await sendTextMessage(phoneNumber, 'Your cart is empty. Pick a product first 👇');
    return sendProductList(phoneNumber);
  }

  const form = session?.form_data || {};
  if (form.name && form.address) {
    await updateSession(phoneNumber, { session_state: 'confirm_details' });
    return sendButtons(phoneNumber, `${cartSummary(cart)}\n\n📦 *Deliver to*\n${form.name}\n${form.address}`, [
      { id: 'confirm_details', title: '✅ Confirm & pay' },
      { id: 'change_details', title: '✏️ Change details' },
      { id: 'add_more', title: '➕ Add more' },
    ]);
  }

  await updateSession(phoneNumber, { session_state: 'ask_name' });
  return sendTextMessage(phoneNumber, `${cartSummary(cart)}\n\nAlmost done! What's your *name*?`);
}

async function placeOrder(phoneNumber: string) {
  const session = await getSession(phoneNumber);
  const cart: CartItem[] = session?.cart_items || [];

  if (cart.length === 0) {
    await sendTextMessage(phoneNumber, 'Your cart is empty. Pick a product first 👇');
    await sendProductList(phoneNumber);
    return;
  }
  if (!session?.form_data?.name || !session?.form_data?.address) return beginCheckout(phoneNumber);

  // Atomic claim: a double-tap on Checkout must not create two orders.
  const { data: claimed } = await supabase
    .from('whatsapp_sessions')
    .update({ session_state: 'processing', updated_at: new Date() })
    .eq('phone_number', phoneNumber)
    .neq('session_state', 'processing')
    .select('id');
  if (!claimed || claimed.length === 0) {
    console.log(`↩️ Checkout already in progress for ${phoneNumber}`);
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
        `Subtotal: ₹${order.subtotal}\nTax (GST): ₹${order.tax}\n*Total: ₹${order.total}*\n\n` +
        `💳 Pay securely here:\n${order.paymentUrl}\n\n` +
        `Your order is confirmed once payment is received. Link valid for 24 hours.`
    );
  } catch (error: any) {
    console.error('❌ Checkout failed:', error.message);
    await updateSession(phoneNumber, { session_state: 'catalog' });
    await sendTextMessage(phoneNumber, '😕 Sorry, we could not create your order. Please try again in a moment.');
  }
}

export async function processCustomerMessage(phoneNumber: string, messageText: string, session: any) {
  const raw = messageText.trim();
  const text = raw.toLowerCase();
  const state = session?.session_state || 'welcome';
  const intent = classify(raw);

  console.log(`📨 Processing message from ${phoneNumber}: "${raw}" (state: ${state}, intent: ${intent ?? 'none'})`);

  if (state === 'processing') return;

  // Answers the bot asked for are never treated as questions
  if (state === 'ask_name') {
    const form = { ...(session.form_data || {}), name: raw.slice(0, 80), address: undefined };
    await updateSession(phoneNumber, { form_data: form, session_state: 'ask_address' });
    return sendTextMessage(phoneNumber, `Thanks ${form.name}! 🏠 Please send your *delivery address*.`);
  }
  if (state === 'ask_address') {
    const form = { ...(session.form_data || {}), address: raw.slice(0, 300) };
    await updateSession(phoneNumber, { form_data: form });
    // Details complete: create the order and send the payment link
    return placeOrder(phoneNumber);
  }

  // "menu" / "order" always brings the bot back, even while staff are handling the chat
  if (intent === 'menu') {
    if (isBotPaused(session)) await resumeBot(phoneNumber);
    return sendWelcome(phoneNumber);
  }

  // Staff are handling this chat: the bot stays quiet (the message waits in the dashboard inbox)
  if (isBotPaused(session)) return;

  // The customer chose "Something else": whatever they write goes to the team
  if (state === 'asking') return handoff(phoneNumber, session);

  if (intent === 'ack') return; // "ok", "thanks", 👍: no reply needed

  if (intent === 'greeting') {
    const recent =
      session?.last_welcome_at && Date.now() - new Date(session.last_welcome_at).getTime() < WELCOME_COOLDOWN_MS;
    if (recent) return;
    return sendWelcome(phoneNumber);
  }

  if (state === 'confirm_details') {
    return sendButtons(phoneNumber, 'Please confirm your delivery details:', [
      { id: 'confirm_details', title: '✅ Confirm & pay' },
      { id: 'change_details', title: '✏️ Change details' },
    ]);
  }

  if (state === 'catalog' && (text.includes('checkout') || /^pay\b/.test(text))) return beginCheckout(phoneNumber);

  // Questions the bot can answer by itself
  if (intent && (await answer(phoneNumber, intent, session))) return;

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
  }

  // Anything else is an enquiry for a person
  return handoff(phoneNumber, session);
}

// Photos, voice notes, documents and locations are for the team; stickers and reactions need no reply
export async function processMediaMessage(phoneNumber: string, kind: string, session: any) {
  if (kind === 'sticker' || kind === 'reaction' || kind === 'unsupported') return;
  if (session?.session_state === 'processing') return;
  if (isBotPaused(session)) return;
  return handoff(phoneNumber, session);
}

export async function processButtonReply(phoneNumber: string, buttonId: string) {
  console.log(`🔘 Button clicked - ${phoneNumber}: ${buttonId}`);

  if (buttonId === 'start_order') {
    // Choosing to order brings the bot back if staff had taken over
    const session = await getSession(phoneNumber);
    if (isBotPaused(session)) await resumeBot(phoneNumber);
    return startOrder(phoneNumber);
  }

  if (buttonId === 'ask_question') return sendFaqMenu(phoneNumber);

  if (buttonId === 'talk_to_us') return handoff(phoneNumber, await getSession(phoneNumber), { explicit: true });

  if (buttonId.startsWith('add:')) return addToCart(phoneNumber, buttonId.slice(4));

  if (buttonId === 'view_products') return sendProductList(phoneNumber);

  if (buttonId === 'add_more') {
    await updateSession(phoneNumber, { session_state: 'catalog' });
    await sendTextMessage(phoneNumber, 'Pick more products and send the cart again. They will be added to your current cart 👇');
    return sendProductList(phoneNumber);
  }

  if (buttonId === 'checkout') return beginCheckout(phoneNumber);

  if (buttonId === 'confirm_details') return placeOrder(phoneNumber);

  if (buttonId === 'change_details') {
    await updateSession(phoneNumber, { session_state: 'ask_name', form_data: {} });
    return sendTextMessage(phoneNumber, "No problem. What's your *name*?");
  }

  if (buttonId === 'clear_cart') {
    await updateSession(phoneNumber, { cart_items: [], session_state: 'catalog' });
    await sendTextMessage(phoneNumber, 'Cart cleared 🗑️');
    return sendProductList(phoneNumber);
  }
}

// Tapping a product in the list shows its photo card; adding happens from the card's button.
export async function processListSelection(phoneNumber: string, productId: string) {
  // Topics from the "Ask a question" menu
  if (productId.startsWith('faq:')) {
    const topic = productId.slice(4) as 'price' | 'delivery' | 'store' | 'status' | 'other';
    return answer(phoneNumber, topic, await getSession(phoneNumber));
  }
  console.log(`👀 Product opened - ${phoneNumber}: ${productId}`);
  return sendProductCard(phoneNumber, productId);
}

async function addToCart(phoneNumber: string, productId: string) {
  console.log(`🛒 Add to cart - ${phoneNumber}: ${productId}`);

  const { data: product } = await supabase
    .from('products')
    .select('id, name, variant, price, stock, gst')
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
      name: `${product.name}${product.variant ? ` ${product.variant}` : ''}`,
      price: Number(product.price),
      quantity: 1,
      gst: Number(product.gst ?? 0),
    });
  }

  await updateSession(phoneNumber, { cart_items: cart, session_state: 'catalog' });
  await sendCartOptions(phoneNumber, cart);
}

function sendCartOptions(phoneNumber: string, cart: CartItem[], note = '') {
  return sendButtons(phoneNumber, `${note}${cartSummary(cart)}\n\nWhat next?`, [
    { id: 'add_more', title: '➕ Add more' },
    { id: 'checkout', title: '✅ Checkout' },
    { id: 'clear_cart', title: '🗑️ Clear cart' },
  ]);
}

type CatalogOrderItem = { product_retailer_id: string; quantity: number | string };

// A cart sent from the WhatsApp catalog is added to what is already in the bot cart (Add more),
// so items picked earlier are kept. Prices, GST and stock come from Inventory, never from the
// message, so a stale catalog price cannot be charged.
export async function processCatalogOrder(phoneNumber: string, items: CatalogOrderItem[], session: any) {
  console.log(`🧺 Catalog cart from ${phoneNumber}: ${JSON.stringify(items)}`);
  if (session?.session_state === 'processing') return;

  // After a finished or abandoned checkout the old cart is not reused
  const keepExisting = ['catalog', 'confirm_details', 'ask_name', 'ask_address'].includes(session?.session_state);
  const existing: CartItem[] = keepExisting ? session?.cart_items || [] : [];

  const ids = [...new Set([...items.map((i) => i.product_retailer_id), ...existing.map((i) => i.product_id)])];
  const { data: products } = await supabase
    .from('products')
    .select('id, name, variant, price, stock, active, gst')
    .in('id', ids);
  const byId = new Map((products || []).map((p: any) => [p.id, p]));

  const wanted = new Map<string, number>();
  for (const i of existing) wanted.set(i.product_id, (wanted.get(i.product_id) ?? 0) + i.quantity);
  for (const i of items) {
    const q = Math.max(1, Math.floor(Number(i.quantity) || 1));
    wanted.set(i.product_retailer_id, (wanted.get(i.product_retailer_id) ?? 0) + q);
  }

  const cart: CartItem[] = [];
  const notes: string[] = [];
  for (const [id, want] of wanted) {
    const p: any = byId.get(id);
    const label = p ? `${p.name}${p.variant ? ` ${p.variant}` : ''}` : 'An item';
    if (!p || !p.active || p.stock <= 0) {
      notes.push(`${label} is no longer available.`);
      continue;
    }
    const quantity = Math.min(want, p.stock);
    if (quantity < want) notes.push(`Only ${p.stock} of ${label} in stock.`);
    cart.push({ product_id: p.id, name: label, price: Number(p.price), quantity, gst: Number(p.gst ?? 0) });
  }

  await updateSession(phoneNumber, { cart_items: cart, session_state: 'catalog' });

  const note = notes.length ? `⚠️ ${notes.join('\n⚠️ ')}\n\n` : '';
  if (!cart.length) {
    await sendTextMessage(phoneNumber, `${note}Your cart is empty. Pick a product 👇`);
    return sendProductList(phoneNumber);
  }
  return sendCartOptions(phoneNumber, cart, note);
}

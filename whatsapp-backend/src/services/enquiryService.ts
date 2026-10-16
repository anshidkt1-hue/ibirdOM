import { supabase } from '../server';
import { sendButtons, sendList, sendProductList, sendTextMessage, STORE_NAME } from './whatsappService';

// ---------- Editable answers (Settings → WhatsApp replies) ----------

export type Replies = { delivery: string; store: string; handoff: string; pause_hours: number };

const DEFAULT_REPLIES: Replies = {
  delivery: '🚚 *Delivery*\nOur team will confirm the delivery time and charges for your area.',
  store: `📍 *${STORE_NAME}*\nOur team will share the store address and timings.`,
  handoff: 'Thanks for your message! 🙏 Our team will reply shortly.\nTo place an order now, tap *Start order*.',
  pause_hours: 4,
};

let repliesCache: { at: number; value: Replies } | null = null;

export async function getReplies(): Promise<Replies> {
  if (repliesCache && Date.now() - repliesCache.at < 60_000) return repliesCache.value;
  const { data } = await supabase
    .from('settings')
    .select('whatsapp_replies')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  const saved = (data?.whatsapp_replies ?? {}) as Partial<Replies>;
  const value: Replies = {
    delivery: saved.delivery?.trim() || DEFAULT_REPLIES.delivery,
    store: saved.store?.trim() || DEFAULT_REPLIES.store,
    handoff: saved.handoff?.trim() || DEFAULT_REPLIES.handoff,
    pause_hours: Math.min(72, Math.max(1, Number(saved.pause_hours) || DEFAULT_REPLIES.pause_hours)),
  };
  repliesCache = { at: Date.now(), value };
  return value;
}

// ---------- What did the customer mean? (English and common Manglish) ----------

export type Intent = 'problem' | 'status' | 'delivery' | 'store' | 'price' | 'greeting' | 'menu' | 'ack' | null;

const PATTERNS: [Exclude<Intent, null>, RegExp][] = [
  ['problem', /\b(refund|return|replace(ment)?|damaged?|broken|complain(t)?|problem|issue|not working|defect(ive)?|wrong (item|product)|payment (failed|issue|problem)|money (deducted|debited)|paid but|cancel (my )?order)\b/i],
  ['status', /\b(order status|status of (my )?order|where is my order|track(ing)?|dispatch(ed)?|shipped|my order|order (id|number|no)|evide (ente|ende) order)\b/i],
  ['delivery', /\b(deliver(y|ed)?|shipping|ship|courier|cod|cash on delivery|eppo(l|zha)? (kittum|ethum)|kittum|ethum|how many days)\b/i],
  ['store', /\b(store|shop|showroom|address|location|located|where are you|timing|timings|open(ing)?|clos(e|ing)|hours|kada|evide(yanu|ya)?|map|visit|direction)\b/i],
  ['price', /\b(price|prices|rate|rates|cost|how much|mrp|offer|discount|vila|vilay|ethra|ethre|ethrayanu|catalog(ue)?|products?|items?|available|stock)\b/i],
];

const GREETING = /^(hi+|hello+|hey+|hai+|helo+|hlo+|good (morning|afternoon|evening)|namaste|assalamu? ?alaikum|salam)[\s!.]*$/i;
const MENU = /^(menu|start|restart|order|start order|shop|buy|cancel)[\s!.]*$/i;
// "ok", "thanks", 👍 and emoji-only messages need no reply
const ACK = /^(ok+|okay|okey|k+|kk|fine|good|nice|super|great|cool|done|sure|noted|received|got it|thanks?|thank ?you|thx|tnx|ty|tq|thank u|shukriya|nanni)[\s!.🙏👍😊❤️]*$/i;
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

export function classify(text: string): Intent {
  const t = text.trim();
  if (!t) return 'ack';
  if (GREETING.test(t)) return 'greeting';
  if (MENU.test(t)) return 'menu';
  if (ACK.test(t) || EMOJI_ONLY.test(t)) return 'ack';
  for (const [intent, re] of PATTERNS) if (re.test(t)) return intent;
  return null;
}

// ---------- Session helpers ----------

async function patchSession(phone: string, patch: Record<string, any>) {
  const { error } = await supabase
    .from('whatsapp_sessions')
    .update({ ...patch, updated_at: new Date() })
    .eq('phone_number', phone);
  if (error) console.error('❌ Session update failed:', error.message);
}

export const isBotPaused = (session: any) =>
  Boolean(session?.bot_paused_until && new Date(session.bot_paused_until).getTime() > Date.now());

export async function resumeBot(phone: string) {
  await patchSession(phone, { bot_paused_until: null });
}

// ---------- Hand-over to staff ----------

// Staff take over: the customer gets one acknowledgement, the bot stays quiet for a few hours
// and the chat shows in the dashboard inbox as "needs reply".
export async function handoff(phone: string, session: any, opts: { explicit?: boolean } = {}) {
  const replies = await getReplies();
  const alreadyWaiting = isBotPaused(session);
  await patchSession(phone, {
    needs_reply: true,
    bot_paused_until: new Date(Date.now() + replies.pause_hours * 3600_000),
    // keep a cart in progress; only leave transient question states
    ...(session?.session_state === 'asking' ? { session_state: 'welcome' } : {}),
  });
  if (alreadyWaiting && !opts.explicit) return; // one acknowledgement per hand-over

  const text = opts.explicit
    ? `📞 Sure! A member of our team will reply here shortly.\n\nYou can also keep shopping meanwhile.`
    : replies.handoff;
  await sendButtons(phone, text, [{ id: 'start_order', title: '🛒 Start order' }]);
}

// ---------- Automatic answers ----------

export async function sendFaqMenu(phone: string) {
  await sendList(phone, 'What would you like to know? Pick a topic 👇', 'Choose a topic', [
    { id: 'faq:price', title: '💰 Prices & products', description: 'See all products with prices and GST' },
    { id: 'faq:delivery', title: '🚚 Delivery', description: 'Delivery time and charges' },
    { id: 'faq:store', title: '📍 Store & timings', description: 'Address, opening hours and map' },
    { id: 'faq:status', title: '📦 My order status', description: 'Status of your latest order' },
    { id: 'faq:other', title: '💬 Something else', description: 'Ask our team directly' },
  ]);
}

async function sendOrderStatus(phone: string, session: any) {
  const { data: wa } = await supabase
    .from('whatsapp_orders')
    .select('order_id, payment_status, payment_link')
    .eq('phone_number', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!wa) {
    await sendButtons(phone, "We couldn't find an order from this number yet.", [{ id: 'start_order', title: '🛒 Start order' }]);
    return;
  }
  const { data: order } = await supabase
    .from('orders')
    .select('order_number, status, total, created_at')
    .eq('id', wa.order_id)
    .maybeSingle();
  const STATUS: Record<string, string> = {
    pending: 'Received ✅ We are preparing it.',
    processing: 'Being packed 📦',
    shipped: 'On the way 🚚',
    completed: 'Delivered 🎉',
    cancelled: 'Cancelled',
  };
  const paid = wa.payment_status === 'captured' || wa.payment_status === 'paid';
  const lines = [
    `📦 *Order ${order?.order_number ?? ''}*`,
    `Status: ${order ? STATUS[order.status] ?? order.status : 'Received'}`,
    order ? `Amount: ₹${order.total}` : '',
    paid ? 'Payment: received ✅' : wa.payment_link ? `Payment pending 💳 Pay here:\n${wa.payment_link}` : 'Payment pending',
  ].filter(Boolean);
  await sendButtons(phone, `${lines.join('\n')}\n\nFor any other help, tap *Talk to us*.`, [
    { id: 'talk_to_us', title: '📞 Talk to us' },
    { id: 'start_order', title: '🛒 New order' },
  ]);
  void session;
}

// Answers a recognised question. Returns false when it is not a question the bot can answer.
export async function answer(phone: string, intent: Intent | 'other', session: any): Promise<boolean> {
  const replies = await getReplies();
  switch (intent) {
    case 'price':
      await sendTextMessage(phone, '💰 Here are our products with prices. GST is added per product at checkout.');
      await sendProductList(phone);
      return true;
    case 'delivery':
      await sendButtons(phone, replies.delivery, [
        { id: 'start_order', title: '🛒 Start order' },
        { id: 'talk_to_us', title: '📞 Talk to us' },
      ]);
      return true;
    case 'store':
      await sendButtons(phone, replies.store, [
        { id: 'start_order', title: '🛒 Start order' },
        { id: 'talk_to_us', title: '📞 Talk to us' },
      ]);
      return true;
    case 'status':
      await sendOrderStatus(phone, session);
      return true;
    case 'problem':
      await handoff(phone, session, { explicit: true });
      return true;
    case 'other':
      await patchSession(phone, { session_state: 'asking' });
      await sendTextMessage(phone, '💬 Please type your question and our team will reply here.');
      return true;
    default:
      return false;
  }
}

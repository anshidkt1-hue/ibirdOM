import crypto from 'crypto';
import Razorpay from 'razorpay';
import { supabase } from '../server';
import { sendTextMessage, STORE_NAME } from './whatsappService';
import { sendPaymentDocuments } from './documentService';

let razorpay: any = null;

function getRazorpayInstance() {
  if (!razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials not found in environment variables');
    }
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
}

function publicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return undefined;
}

export async function createPaymentLink(
  orderId: string,
  orderData: {
    order_number: string;
    customer_name: string;
    customer_phone: string;
    amount: number;
  }
) {
  const baseUrl = publicBaseUrl();

  const paymentLink = await getRazorpayInstance().paymentLink.create({
    amount: Math.round(orderData.amount * 100),
    currency: 'INR',
    accept_partial: false,
    expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    reference_id: orderData.order_number,
    description: `${STORE_NAME} Order ${orderData.order_number}`,
    customer: {
      name: orderData.customer_name,
      contact: `+${orderData.customer_phone}`,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    ...(baseUrl
      ? { callback_url: `${baseUrl}/api/payments/callback`, callback_method: 'get' }
      : {}),
    notes: { order_id: orderId },
  });

  await supabase
    .from('whatsapp_orders')
    .update({
      payment_link: paymentLink.short_url,
      razorpay_order_id: paymentLink.id,
      updated_at: new Date(),
    })
    .eq('order_id', orderId);

  console.log(`✅ Payment link created for order ${orderData.order_number}`);
  return paymentLink;
}

export function verifyPaymentLinkSignature(
  linkId: string,
  referenceId: string,
  status: string,
  paymentId: string,
  signature: string
) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${linkId}|${referenceId}|${status}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

export function verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}

export async function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return expected === razorpaySignature;
}

export async function handlePaymentSuccess(paymentLinkId: string, paymentId: string) {
  const { data: wa, error } = await supabase
    .from('whatsapp_orders')
    .select('*')
    .eq('razorpay_order_id', paymentLinkId)
    .maybeSingle();

  if (error || !wa) {
    throw new Error(`WhatsApp order not found for payment link ${paymentLinkId}`);
  }

  // Atomic claim: the redirect callback and the webhook can fire together, and only one may proceed.
  const { data: claimed, error: claimError } = await supabase
    .from('whatsapp_orders')
    .update({ razorpay_payment_id: paymentId, payment_status: 'captured', updated_at: new Date() })
    .eq('id', wa.id)
    .neq('payment_status', 'captured')
    .select('id');

  if (claimError) throw new Error(`Payment claim failed: ${claimError.message}`);
  if (!claimed || claimed.length === 0) {
    return { success: true, alreadyProcessed: true, couponCode: null };
  }

  const { error: stockError } = await supabase.rpc('apply_order_stock', { p_order_id: wa.order_id });
  if (stockError) console.error('❌ Stock deduction failed:', stockError.message);

  await supabase
    .from('orders')
    .update({ payment_status: 'paid', updated_at: new Date() })
    .eq('id', wa.order_id);

  const { data: order } = await supabase
    .from('orders')
    .select('order_number, total, customer_id')
    .eq('id', wa.order_id)
    .single();

  const coupons = await issueGiveawayCoupons(wa.order_id);
  const couponCode = coupons[0]?.coupon_code ?? null;

  const couponText = !coupons.length
    ? ''
    : coupons.length === 1
      ? `\n\n🎁 Your Thar ROXX giveaway coupon: *${coupons[0].coupon_code}*\nKeep this code safe. It is your entry in the Thar ROXX giveaway draw.`
      : `\n\n🎁 You get *${coupons.length} Thar ROXX giveaway coupons*, one for each product:\n` +
        coupons.map((c) => `${c.coupon_seq}. *${c.coupon_code}* · ${c.product_name ?? 'Product'}`).join('\n') +
        `\nEach code is a separate entry in the Thar ROXX giveaway draw.`;

  try {
    await sendTextMessage(
      wa.phone_number,
      `✅ Payment received!\n\nOrder ${order?.order_number} (₹${order?.total}) is confirmed and our team will process it shortly.` +
        couponText +
        `\n\nYour invoice${coupons.length ? ` and coupon${coupons.length > 1 ? 's' : ''} follow` : ' follows'} below.` +
        `\n\nThank you for shopping with ${STORE_NAME}!`
    );
  } catch (err) {
    console.error('❌ Could not send payment confirmation message');
  }

  // Invoice PDF and coupon image in the background, so the payment redirect is not held up;
  // failures are logged and never undo the payment
  void sendPaymentDocuments(wa.order_id, wa.phone_number);

  console.log(`✅ Payment captured for order ${order?.order_number}`);
  return { success: true, alreadyProcessed: false, couponCode };
}

// One Thar ROXX giveaway coupon per product unit in the order (an entry code, not a discount),
// issued once by the database even when the payment callback and webhook arrive together
async function issueGiveawayCoupons(orderId: string): Promise<GiveawayCoupon[]> {
  const { data, error } = await supabase.rpc('issue_giveaway_coupons', { p_order_id: orderId });
  if (error) {
    console.error('❌ Giveaway coupons failed:', error.message);
    return [];
  }
  return (data || []) as GiveawayCoupon[];
}

type GiveawayCoupon = { coupon_code: string; coupon_seq: number; product_name: string | null };

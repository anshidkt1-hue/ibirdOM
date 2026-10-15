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

  const couponCode = await generateGiveawayCoupon(order?.customer_id, wa.order_id);

  try {
    await sendTextMessage(
      wa.phone_number,
      `✅ Payment received!\n\nOrder ${order?.order_number} (₹${order?.total}) is confirmed and our team will process it shortly.` +
        (couponCode
          ? `\n\n🎁 Your Thar ROXX giveaway coupon: *${couponCode}*\nKeep this code safe. It is your entry in the Thar ROXX giveaway draw.`
          : '') +
        `\n\nYour invoice${couponCode ? ' and coupon follow' : ' follows'} below.` +
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

// Letters and digits that cannot be confused when read aloud or copied (no 0/O, 1/I/L).
const COUPON_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCouponCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += COUPON_ALPHABET[crypto.randomInt(COUPON_ALPHABET.length)];
  }
  return `THAR-${code}`;
}

// One Thar ROXX giveaway coupon per paid order. It is an entry code, not a discount.
async function generateGiveawayCoupon(customerId: string | null | undefined, orderId: string) {
  if (!customerId) return null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const couponCode = randomCouponCode();
    const { error } = await supabase.from('coupons').insert({
      customer_id: customerId,
      order_id: orderId,
      coupon_code: couponCode,
      discount_percentage: 0,
      campaign: 'thar-roxx-giveaway',
    });

    if (!error) return couponCode;
    if (error.code === '23505') {
      // Same order already has its coupon: return it. Otherwise the code clashed, so try another.
      const { data: existing } = await supabase
        .from('coupons')
        .select('coupon_code')
        .eq('order_id', orderId)
        .eq('campaign', 'thar-roxx-giveaway')
        .maybeSingle();
      if (existing) return existing.coupon_code as string;
      continue;
    }
    console.error('❌ Giveaway coupon insert failed:', error.message);
    return null;
  }
  return null;
}

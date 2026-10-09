import crypto from 'crypto';
import Razorpay from 'razorpay';
import { supabase } from '../server';
import { sendTextMessage } from './whatsappService';

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
    description: `ibird Order ${orderData.order_number}`,
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

  if (wa.payment_status === 'captured') {
    return { success: true, alreadyProcessed: true, couponCode: null };
  }

  await supabase
    .from('whatsapp_orders')
    .update({ razorpay_payment_id: paymentId, payment_status: 'captured', updated_at: new Date() })
    .eq('id', wa.id);

  await supabase
    .from('orders')
    .update({ payment_status: 'paid', updated_at: new Date() })
    .eq('id', wa.order_id);

  const { data: order } = await supabase
    .from('orders')
    .select('order_number, total, customer_id')
    .eq('id', wa.order_id)
    .single();

  const couponCode = await generateCoupon(order?.customer_id);

  try {
    await sendTextMessage(
      wa.phone_number,
      `✅ Payment received!\n\nOrder ${order?.order_number} (₹${order?.total}) is confirmed and our team will process it shortly.` +
        (couponCode ? `\n\n🎁 Your 10% off coupon for next time: ${couponCode}` : '') +
        `\n\nThank you for shopping with ibird!`
    );
  } catch (err) {
    console.error('❌ Could not send payment confirmation message');
  }

  console.log(`✅ Payment captured for order ${order?.order_number}`);
  return { success: true, alreadyProcessed: false, couponCode };
}

async function generateCoupon(customerId?: string | null) {
  try {
    if (!customerId) return null;
    const couponCode = `IBIRD${Date.now().toString(36).toUpperCase()}`;
    const validityEnd = new Date();
    validityEnd.setDate(validityEnd.getDate() + 30);

    const { error } = await supabase.from('coupons').insert({
      customer_id: customerId,
      coupon_code: couponCode,
      discount_percentage: 10,
      validity_end: validityEnd.toISOString().split('T')[0],
    });
    if (error) {
      console.error('❌ Coupon insert failed:', error.message);
      return null;
    }
    return couponCode;
  } catch (error: any) {
    console.error('❌ Coupon generation failed:', error);
    return null;
  }
}

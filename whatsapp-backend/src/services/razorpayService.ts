import Razorpay from 'razorpay';
import { supabase } from '../server';
import { sendWhatsAppMessage } from './whatsappService';

// Lazy initialization - only when needed
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

export async function createPaymentLink(
  orderId: string,
  orderData: {
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    amount: number;
    delivery_address: string;
  }
) {
  try {
    const paymentLink = await getRazorpayInstance().paymentLink.create({
      amount: Math.round(orderData.amount * 100), // Convert to paise
      currency: 'INR',
      accept_partial: false,
      expire_by: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      reference_id: orderId,
      description: `ibird Order #${orderId}`,
      customer_details: {
        name: orderData.customer_name,
        email: orderData.customer_email,
        contact: orderData.customer_phone,
      },
      notify: {
        sms: true,
        email: true,
      },
      notes: {
        delivery_address: orderData.delivery_address,
        order_id: orderId,
      },
    });

    // Save payment link
    await supabase
      .from('whatsapp_orders')
      .update({
        payment_link: paymentLink.short_url,
        razorpay_order_id: paymentLink.id,
      })
      .eq('order_id', orderId);

    console.log(`✅ Payment link created for order ${orderId}`);

    return paymentLink;
  } catch (error: any) {
    console.error('❌ Payment link creation failed:', error);
    throw error;
  }
}

export async function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
) {
  const crypto = require('crypto');

  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}

export async function handlePaymentSuccess(paymentData: any) {
  try {
    const { razorpay_order_id, razorpay_payment_id } = paymentData;

    // Get WhatsApp order
    const { data: whatsappOrder, error } = await supabase
      .from('whatsapp_orders')
      .select('*')
      .eq('razorpay_order_id', razorpay_order_id)
      .single();

    if (error || !whatsappOrder) {
      throw new Error('Order not found');
    }

    // Update order status
    await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        status: 'confirmed',
      })
      .eq('id', whatsappOrder.order_id);

    // Update WhatsApp order
    await supabase
      .from('whatsapp_orders')
      .update({
        razorpay_payment_id,
        payment_status: 'captured',
        updated_at: new Date(),
      })
      .eq('razorpay_order_id', razorpay_order_id);

    // Generate coupon
    const couponCode = await generateCoupon(whatsappOrder.order_id);

    // Send confirmation message with coupon
    await sendWhatsAppMessage(
      whatsappOrder.phone_number,
      'order_confirmation',
      [
        { type: 'text', text: whatsappOrder.order_id },
        { type: 'text', text: paymentData.amount.toString() },
      ]
    );

    console.log(`✅ Payment verified for order ${whatsappOrder.order_id}`);

    return { success: true, couponCode };
  } catch (error: any) {
    console.error('❌ Payment verification failed:', error);
    throw error;
  }
}

async function generateCoupon(orderId: string) {
  try {
    const couponCode = `IBIRD${Date.now().toString(36).toUpperCase()}`;
    const validityEnd = new Date();
    validityEnd.setDate(validityEnd.getDate() + 30);

    // Get customer from order
    const { data: order } = await supabase
      .from('orders')
      .select('customer_id')
      .eq('id', orderId)
      .single();

    if (order?.customer_id) {
      await supabase.from('coupons').insert({
        customer_id: order.customer_id,
        coupon_code: couponCode,
        discount_percentage: 10,
        validity_end: validityEnd.toISOString().split('T')[0],
      });

      console.log(`✅ Coupon generated: ${couponCode}`);
    }

    return couponCode;
  } catch (error: any) {
    console.error('❌ Coupon generation failed:', error);
    return null;
  }
}
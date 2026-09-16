import { Request, Response } from 'express';
import { supabase } from '../server';
import { v4 as uuidv4 } from 'uuid';
import { createPaymentLink } from '../services/razorpayService';
import { sendWhatsAppMessage } from '../services/whatsappService';

export async function createOrderFromWhatsApp(req: Request, res: Response) {
  try {
    const {
      phoneNumber,
      cartItems,
      customerData,
    } = req.body;

    console.log(`📦 Creating order for ${phoneNumber}`);

    // Validate input
    if (!phoneNumber || !cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get or create customer
    let customerId = null;
    let customerEmail = customerData?.email || `customer_${phoneNumber}@ibird.local`;

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', phoneNumber)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert({
          name: customerData?.name || 'WhatsApp Customer',
          phone: phoneNumber,
          email: customerEmail,
          address: customerData?.address || '',
        })
        .select('id')
        .single();

      customerId = newCustomer?.id;
    }

    // Calculate totals
    const subtotal = cartItems.reduce((sum: number, item: any) => {
      return sum + (item.price * item.quantity);
    }, 0);

    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const total = subtotal + tax;

    // Create order
    const orderId = uuidv4();
    const orderNumber = `WA-${Date.now().toString().slice(-8)}`;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        id: orderId,
        order_number: orderNumber,
        customer_id: customerId,
        customer_name: customerData?.name || 'WhatsApp Customer',
        customer_phone: phoneNumber,
        source: 'whatsapp',
        status: 'pending',
        payment_method: 'razorpay',
        payment_status: 'pending',
        delivery_address: customerData?.address || '',
        special_instructions: customerData?.instructions || '',
        subtotal,
        tax,
        total,
        items: cartItems.map((item: any) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
          name: item.name,
        })),
      })
      .select()
      .single();

    if (orderError) {
      throw new Error(`Failed to create order: ${orderError.message}`);
    }

    // Link WhatsApp order
    const { data: whatsappOrder, error: whatsappError } = await supabase
      .from('whatsapp_orders')
      .insert({
        order_id: orderId,
        phone_number: phoneNumber,
        payment_status: 'pending',
      })
      .select()
      .single();

    if (whatsappError) {
      throw new Error(`Failed to link WhatsApp order: ${whatsappError.message}`);
    }

    // Create payment link
    const paymentLink = await createPaymentLink(orderId, {
      customer_name: customerData?.name || 'Customer',
      customer_email: customerEmail,
      customer_phone: phoneNumber,
      amount: total,
      delivery_address: customerData?.address || '',
    });

    // Send payment link via WhatsApp
    await sendWhatsAppMessage(
      phoneNumber,
      'order_confirmation',
      [
        { type: 'text', text: orderNumber },
        { type: 'text', text: total.toString() },
        { type: 'text', text: customerData?.address || 'Delivery Address' },
        { type: 'text', text: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString() },
      ]
    );

    console.log(`✅ Order created: ${orderNumber} | Payment Link: ${paymentLink.short_url}`);

    res.json({
      success: true,
      orderId: order.id,
      orderNumber: order.order_number,
      total: order.total,
      paymentLink: paymentLink.short_url,
    });
  } catch (error: any) {
    console.error('❌ Order creation failed:', error);
    res.status(400).json({ error: error.message });
  }
}

export async function getOrderStatus(req: Request, res: Response) {
  try {
    const { orderId } = req.params;

    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({
      success: true,
      order,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}

export async function updateOrderStatus(req: Request, res: Response) {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const { data: order, error: updateError } = await supabase
      .from('orders')
      .update({
        status,
        notes: notes || null,
        updated_at: new Date(),
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Get WhatsApp phone number
    const { data: whatsappOrder } = await supabase
      .from('whatsapp_orders')
      .select('phone_number')
      .eq('order_id', orderId)
      .single();

    // Send status update via WhatsApp
    if (whatsappOrder && status === 'shipped') {
      await sendWhatsAppMessage(
        whatsappOrder.phone_number,
        'order_shipped',
        [
          { type: 'text', text: order.order_number },
          { type: 'text', text: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString() },
        ]
      );
    } else if (whatsappOrder && status === 'delivered') {
      await sendWhatsAppMessage(
        whatsappOrder.phone_number,
        'order_delivered',
        [
          { type: 'text', text: order.order_number },
          { type: 'text', text: new Date().toLocaleDateString() },
          { type: 'text', text: 'https://example.com/rate' },
        ]
      );
    }

    console.log(`✅ Order ${orderId} status updated to ${status}`);

    res.json({
      success: true,
      order,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}
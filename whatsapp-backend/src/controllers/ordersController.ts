import { Request, Response } from 'express';
import { supabase } from '../server';
import { createWhatsAppOrder } from '../services/orderService';
import { sendWhatsAppMessage } from '../services/whatsappService';

export async function createOrderFromWhatsApp(req: Request, res: Response) {
  try {
    const { phoneNumber, cartItems, customerData } = req.body;

    if (!phoneNumber || !cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const order = await createWhatsAppOrder(phoneNumber, cartItems, {
      name: customerData?.name,
      address: customerData?.address,
      instructions: customerData?.instructions,
    });

    res.json({
      success: true,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      total: order.total,
      paymentLink: order.paymentUrl,
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

    res.json({ success: true, order });
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

    const { data: previous } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single();

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

    await supabase.from('order_status_history').insert({
      order_id: orderId,
      old_status: previous?.status || null,
      new_status: status,
      notes: notes || null,
    });

    const { data: whatsappOrder } = await supabase
      .from('whatsapp_orders')
      .select('phone_number')
      .eq('order_id', orderId)
      .single();

    if (whatsappOrder && status === 'shipped') {
      await sendWhatsAppMessage(whatsappOrder.phone_number, 'order_shipped', [
        { type: 'text', text: order.order_number },
        { type: 'text', text: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString() },
      ]);
    } else if (whatsappOrder && status === 'delivered') {
      await sendWhatsAppMessage(whatsappOrder.phone_number, 'order_delivered', [
        { type: 'text', text: order.order_number },
        { type: 'text', text: new Date().toLocaleDateString() },
        { type: 'text', text: 'https://example.com/rate' },
      ]);
    }

    console.log(`✅ Order ${orderId} status updated to ${status}`);

    res.json({ success: true, order });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}

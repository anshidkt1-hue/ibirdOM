import { supabase } from '../server';
import { sendProductList, sendWhatsAppMessage } from './whatsappService';

export async function processCustomerMessage(
  phoneNumber: string,
  messageText: string,
  session: any
) {
  const text = messageText.toLowerCase().trim();

  console.log(`📨 Processing message from ${phoneNumber}: "${messageText}"`);

  // Check session state
  const state = session?.session_state || 'welcome';

  if (state === 'welcome') {
    if (text.includes('order') || text.includes('buy') || text.includes('shop')) {
      // Start order process
      await supabase
        .from('whatsapp_sessions')
        .update({
          session_state: 'form',
          updated_at: new Date(),
        })
        .eq('phone_number', phoneNumber);

      await sendWhatsAppMessage(phoneNumber, 'welcome_message', [
        { type: 'text', text: 'Valued Customer' },
      ]);
    } else {
      // Default response
      await sendWhatsAppMessage(phoneNumber, 'welcome_message', [
        { type: 'text', text: 'Customer' },
      ]);
    }
  } else if (state === 'catalog') {
    // User is browsing products
    if (text.includes('more') || text.includes('add') || text.includes('cart')) {
      await sendProductList(phoneNumber);
    } else if (text.includes('checkout') || text.includes('pay') || text.includes('payment')) {
      // Proceed to cart
      await supabase
        .from('whatsapp_sessions')
        .update({
          session_state: 'payment',
          updated_at: new Date(),
        })
        .eq('phone_number', phoneNumber);

      const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('phone_number', phoneNumber)
        .single();

      if (session?.cart_items?.length > 0) {
        // TODO: Create order and send payment link
        console.log('📦 Cart items:', session.cart_items);
      }
    }
  } else if (state === 'payment') {
    // Payment state - waiting for confirmation
    if (text.includes('paid') || text.includes('done') || text.includes('success')) {
      await supabase
        .from('whatsapp_sessions')
        .update({
          session_state: 'completed',
          updated_at: new Date(),
        })
        .eq('phone_number', phoneNumber);

      await sendWhatsAppMessage(phoneNumber, 'order_delivered', [
        { type: 'text', text: 'Thank you for your purchase!' },
      ]);
    }
  }
}
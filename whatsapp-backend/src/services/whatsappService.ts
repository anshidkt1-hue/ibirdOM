import axios from 'axios';
import { supabase } from '../server';

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0`;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

export async function sendWhatsAppMessage(
  phoneNumber: string,
  templateName: string,
  variables?: { type: string; text: string }[]
) {
  try {
    const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en',
        },
        components: variables ? [
          {
            type: 'body',
            parameters: variables,
          },
        ] : undefined,
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`✅ Message sent to ${phoneNumber}`);

    // Log message
    await supabase.from('whatsapp_messages').insert({
      phone_number: phoneNumber,
      message_type: 'outbound',
      template_name: templateName,
      status: 'sent',
    });

    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send message:`, error.response?.data);
    throw error;
  }
}

export async function sendTextMessage(phoneNumber: string, text: string) {
  try {
    const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'text',
      text: {
        preview_url: true,
        body: text,
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`✅ Text message sent to ${phoneNumber}`);

    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send text message:`, error.response?.data);
    throw error;
  }
}

export async function sendProductList(phoneNumber: string) {
  try {
    // Fetch products from ibird
    const { data: products } = await supabase
      .from('products')
      .select('id, name, price, stock, description')
      .gt('stock', 0)
      .limit(10);

    if (!products || products.length === 0) {
      await sendTextMessage(phoneNumber, '❌ No products available at the moment. Please try again later.');
      return;
    }

    const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: '📦 Select a product to add to cart:',
        },
        footer: {
          text: 'ibird Business Suite',
        },
        action: {
          button: 'View Products',
          sections: [
            {
              title: 'Available Products',
              rows: products.map((p: any) => ({
                id: p.id,
                title: p.name,
                description: `₹${p.price} | Stock: ${p.stock}`,
              })),
            },
          ],
        },
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`✅ Product list sent to ${phoneNumber}`);

    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send product list:`, error.response?.data);
    throw error;
  }
}
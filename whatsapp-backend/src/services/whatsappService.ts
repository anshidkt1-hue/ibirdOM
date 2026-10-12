import axios from 'axios';
import { supabase } from '../server';

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0`;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const RETRY_DELAYS_MS = [500, 1500, 4000];

// Burst traffic can trigger 429/5xx from the WhatsApp API; retry those, never 4xx client errors.
async function postWithRetry(url: string, payload: unknown) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
    } catch (error: any) {
      const status = error.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

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

    const response = await postWithRetry(url, payload);

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

    const response = await postWithRetry(url, payload);

    console.log(`✅ Text message sent to ${phoneNumber}`);

    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send text message:`, error.response?.data);
    throw error;
  }
}

export const STORE_NAME = process.env.STORE_NAME || 'ibird';

export async function sendButtons(
  phoneNumber: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
  headerImageUrl?: string | null
) {
  try {
    const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(headerImageUrl ? { header: { type: 'image', image: { link: headerImageUrl } } } : {}),
        body: { text: bodyText.slice(0, 1024) },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    };

    const response = await postWithRetry(url, payload);

    console.log(`✅ Buttons sent to ${phoneNumber}`);
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send buttons:`, error.response?.data);
    throw error;
  }
}

const CATALOG_FIELDS = 'id, name, variant, price, stock, gst, image_url';
const CATALOG_LIMIT = 10;

// Only products marked "WhatsApp / online" in Inventory are offered here, read live on every request.
async function fetchOnlineProducts() {
  const base = () =>
    supabase.from('products').select(CATALOG_FIELDS).eq('active', true).gt('stock', 0).order('name').limit(CATALOG_LIMIT);

  let { data, error } = await base().eq('sales_channel', 'online');
  if (error && /sales_channel/.test(error.message)) {
    // Channel column not migrated yet: fall back to all active products
    ({ data, error } = await base());
  }
  if (error) console.error('❌ Product query failed:', error.message);
  return data || [];
}

// WhatsApp list messages cannot show pictures, so each product is sent as its own card:
// photo on top, name / price / GST in the body, and an "Add to cart" button.
export async function sendProductList(phoneNumber: string) {
  const products = await fetchOnlineProducts();

  if (products.length === 0) {
    await sendTextMessage(phoneNumber, '❌ No products available at the moment. Please try again later.');
    return;
  }

  await sendTextMessage(phoneNumber, '🛍️ Here are our products. Tap *Add to cart* under the ones you want.');

  for (const p of products as any[]) {
    const body =
      `*${p.name}*${p.variant ? ` (${p.variant})` : ''}\n` +
      `₹${p.price}  +  ${Number(p.gst ?? 0)}% GST\n` +
      `In stock: ${p.stock}`;
    const buttons = [{ id: `add:${p.id}`, title: '🛒 Add to cart' }];
    try {
      await sendButtons(phoneNumber, body, buttons, p.image_url || null);
    } catch {
      if (!p.image_url) throw new Error(`Could not send product ${p.id}`);
      // A broken or private image link must not hide the product
      await sendButtons(phoneNumber, body, buttons, null);
    }
  }

  console.log(`✅ Product cards sent to ${phoneNumber} (${products.length})`);
}
import axios from 'axios';
import { supabase } from '../server';
import { CATALOG_ID, syncCatalogIfStale } from './catalogService';

const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0`;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const RETRY_DELAYS_MS = [500, 1500, 4000];

// Burst traffic can trigger 429/5xx from the WhatsApp API; retry those, never 4xx client errors.
// Who sent an outbound message: the bot (default) or a staff member replying from the inbox
export type SentBy = { id: string; name: string } | null;

// A readable line for the inbox, whatever kind of message was sent
function summarize(payload: any): { body: string; kind: string } {
  const type = payload?.type ?? 'message';
  if (type === 'text') return { body: payload.text?.body ?? '', kind: 'text' };
  if (type === 'interactive') {
    const i = payload.interactive ?? {};
    if (i.type === 'product_list') return { body: `🛍️ Product catalogue: ${i.body?.text ?? ''}`, kind: 'catalog' };
    const buttons = (i.action?.buttons ?? []).map((b: any) => `[${b.reply?.title}]`).join(' ');
    const list = i.action?.button ? `[${i.action.button}]` : '';
    return { body: [i.body?.text, buttons || list].filter(Boolean).join('\n'), kind: i.type ?? 'interactive' };
  }
  if (type === 'document') return { body: `📄 ${payload.document?.filename ?? 'Document'}${payload.document?.caption ? ` · ${payload.document.caption}` : ''}`, kind: 'document' };
  if (type === 'image') return { body: `🖼️ ${payload.image?.caption ?? 'Image'}`, kind: 'image' };
  if (type === 'template') return { body: `Template: ${payload.template?.name ?? ''}`, kind: 'template' };
  return { body: `[${type}]`, kind: type };
}

async function logOutbound(payload: any, sentBy: SentBy, waMessageId?: string) {
  const { body, kind } = summarize(payload);
  const { error } = await supabase.from('whatsapp_messages').insert({
    phone_number: payload?.to,
    message_type: 'outbound',
    body,
    kind,
    status: 'sent',
    template_name: payload?.type === 'template' ? payload.template?.name : null,
    wa_message_id: waMessageId ?? null,
    sent_by: sentBy?.id ?? null,
    sent_by_name: sentBy?.name ?? null,
  });
  if (error) console.error('❌ Outbound log failed:', error.message);
}

async function postWithRetry(url: string, payload: unknown, sentBy: SentBy = null) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      // Every message the customer receives is kept for the inbox (never blocks sending)
      void logOutbound(payload, sentBy, response.data?.messages?.[0]?.id);
      return response;
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

    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send message:`, error.response?.data);
    throw error;
  }
}

export async function sendTextMessage(phoneNumber: string, text: string, sentBy: SentBy = null) {
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

    const response = await postWithRetry(url, payload, sentBy);

    console.log(`✅ Text message sent to ${phoneNumber}`);

    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to send text message:`, error.response?.data);
    throw error;
  }
}

export const STORE_NAME = process.env.STORE_NAME || 'ibird';

// A tappable menu of up to 10 rows (WhatsApp limits: title 24, description 72 characters)
export async function sendList(
  phoneNumber: string,
  bodyText: string,
  buttonLabel: string,
  rows: { id: string; title: string; description?: string }[]
) {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;
  await postWithRetry(url, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText.slice(0, 1024) },
      footer: { text: STORE_NAME },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: [
          {
            title: 'Topics',
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  });
}

// Media by public link: a PDF document (shown with its file name) or an image with a caption
export async function sendDocument(phoneNumber: string, link: string, filename: string, caption?: string) {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;
  await postWithRetry(url, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'document',
    document: { link, filename, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
  });
  console.log(`✅ Document ${filename} sent to ${phoneNumber}`);
}

export async function sendImage(phoneNumber: string, link: string, caption?: string) {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;
  await postWithRetry(url, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'image',
    image: { link, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
  });
  console.log(`✅ Image sent to ${phoneNumber}`);
}

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

const CATALOG_FIELDS = 'id, name, variant, price, stock, gst, image_url, active';
const CATALOG_LIMIT = 30;

// Only products marked "WhatsApp / online" in Inventory are offered here, read live on every request.
async function fetchOnlineProducts() {
  const base = () =>
    supabase.from('products').select(CATALOG_FIELDS).eq('active', true).gt('stock', 0).order('name').limit(CATALOG_LIMIT);

  // 'both' = sold on WhatsApp and at the counter from the same stock
  let { data, error } = await base().in('sales_channel', ['online', 'both']);
  if (error && /sales_channel/.test(error.message)) {
    // Channel column not migrated yet: fall back to all active products
    ({ data, error } = await base());
  }
  if (error) console.error('❌ Product query failed:', error.message);
  return data || [];
}

function priceLine(p: any) {
  return `₹${p.price} + ${Number(p.gst ?? 0)}% GST`;
}

const CATALOG_MAX_ITEMS = 30;

// One catalog message: every product with its photo, price and an Add button; the customer
// builds the cart in WhatsApp and sends it, which arrives as an "order" message.
async function sendCatalogList(phoneNumber: string, products: any[]) {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'interactive',
    interactive: {
      type: 'product_list',
      header: { type: 'text', text: `${STORE_NAME} products` },
      body: { text: '🛍️ Tap a product to see its photo, then *Add* it to your cart. When you are done, open the cart and tap *Send*.' },
      footer: { text: 'Prices + GST' },
      action: {
        catalog_id: CATALOG_ID,
        sections: [
          {
            title: 'Products',
            product_items: products.slice(0, CATALOG_MAX_ITEMS).map((p) => ({ product_retailer_id: p.id })),
          },
        ],
      },
    },
  };
  await postWithRetry(url, payload);
  console.log(`✅ Catalog list sent to ${phoneNumber} (${Math.min(products.length, CATALOG_MAX_ITEMS)})`);
}

export async function sendProductList(phoneNumber: string) {
  syncCatalogIfStale();
  const products = await fetchOnlineProducts();

  if (products.length === 0) {
    await sendTextMessage(phoneNumber, '❌ No products available at the moment. Please try again later.');
    return;
  }

  const inCatalog = (products as any[]).filter((p) => /\.(jpe?g|png)(\?|$)/i.test(p.image_url || ''));
  if (CATALOG_ID && inCatalog.length) {
    try {
      return await sendCatalogList(phoneNumber, inCatalog);
    } catch (error: any) {
      // e.g. a product still in Meta review: fall back to the plain list so ordering never stops
      console.error('❌ Catalog list failed, sending plain list:', error.response?.data || error.message);
    }
  }

  return sendPlainProductList(phoneNumber, products);
}

// Fallback list message. WhatsApp list rows cannot carry images,
// so the photo is shown when the customer taps a product (see sendProductCard).
async function sendPlainProductList(phoneNumber: string, products: any[]) {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: '🛍️ Tap *View products* and choose an item to see its photo and add it to your cart.' },
      footer: { text: STORE_NAME },
      action: {
        button: 'View products',
        sections: [
          {
            title: 'Products',
            // WhatsApp list messages allow at most 10 rows
            rows: products.slice(0, 10).map((p) => ({
              id: p.id,
              title: `${p.name}${p.variant ? ` ${p.variant}` : ''}`.slice(0, 24),
              description: `${priceLine(p)} · In stock ${p.stock}`.slice(0, 72),
            })),
          },
        ],
      },
    },
  };

  try {
    await postWithRetry(url, payload);
    console.log(`✅ Product list sent to ${phoneNumber} (${products.length})`);
  } catch (error: any) {
    console.error('❌ Failed to send product list:', error.response?.data);
    throw error;
  }
}

// The chosen product with its photo, price and GST, plus Add to cart / Back to list.
export async function sendProductCard(phoneNumber: string, productId: string) {
  const { data } = await supabase.from('products').select(CATALOG_FIELDS).eq('id', productId).maybeSingle();
  const product = data as any;

  if (!product || !product.active || product.stock <= 0) {
    await sendTextMessage(phoneNumber, 'Sorry, that product is no longer available.');
    return sendProductList(phoneNumber);
  }

  const body =
    `*${product.name}*${product.variant ? ` (${product.variant})` : ''}\n` +
    `${priceLine(product)}\n` +
    `In stock: ${product.stock}`;
  const buttons = [
    { id: `add:${product.id}`, title: '🛒 Add to cart' },
    { id: 'view_products', title: '⬅️ Back to list' },
  ];

  // WhatsApp accepts AVIF/WebP links but then silently fails to deliver the message,
  // so only JPEG/PNG photos are attached; anything else is sent without a photo.
  const image = /\.(jpe?g|png)(\?|$)/i.test(product.image_url || '') ? product.image_url : null;
  if (product.image_url && !image) {
    console.warn(`⚠️ Unsupported photo format for ${product.name}; re-upload it in Inventory as JPEG/PNG`);
  }

  try {
    await sendButtons(phoneNumber, body, buttons, image);
  } catch (error) {
    if (!image) throw error;
    // A broken or private image link must not block the order
    await sendButtons(phoneNumber, body, buttons, null);
  }
}
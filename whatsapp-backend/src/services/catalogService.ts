import axios from 'axios';
import { supabase } from '../server';

// Meta Commerce catalog shown in WhatsApp: one product list with photos and an in-chat cart.
// Products are mirrored from Inventory ("WhatsApp / online" products); retailer id = product id.
export const CATALOG_ID = process.env.WHATSAPP_CATALOG_ID;

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const STORE_URL = process.env.STORE_URL || 'https://ibirdhomes.com/';
const BRAND = process.env.STORE_NAME || 'ibird';
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 3 * 60 * 1000;

const SUPPORTED_IMAGE = /\.(jpe?g|png)(\?|$)/i;

let lastSyncAt = 0;
let syncing: Promise<SyncResult> | null = null;

export type SyncResult = { synced: number; removed: number; skipped: string[] };

async function fetchChannelProducts() {
  const fields = 'id, name, variant, price, stock, gst, image_url, active, category';
  let { data, error } = await supabase.from('products').select(fields).eq('sales_channel', 'online');
  if (error && /sales_channel/.test(error.message)) {
    ({ data, error } = await supabase.from('products').select(fields));
  }
  if (error) throw new Error(`Product query failed: ${error.message}`);
  return (data || []) as any[];
}

async function fetchCatalogRetailerIds(): Promise<string[]> {
  const ids: string[] = [];
  let url: string | null = `${GRAPH_URL}/${CATALOG_ID}/products?fields=retailer_id&limit=100`;
  while (url) {
    const res: any = await axios.get(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, timeout: 15000 });
    ids.push(...(res.data.data || []).map((p: any) => p.retailer_id));
    url = res.data.paging?.next || null;
  }
  return ids;
}

function catalogItem(p: any) {
  const title = `${p.name}${p.variant ? ` ${p.variant}` : ''}`.slice(0, 150);
  return {
    id: p.id,
    title,
    description: `${title} · ₹${p.price} + ${Number(p.gst ?? 0)}% GST`,
    availability: p.active && p.stock > 0 ? 'in stock' : 'out of stock',
    inventory: Math.max(0, Number(p.stock) || 0),
    condition: 'new',
    price: `${Number(p.price).toFixed(2)} INR`,
    link: STORE_URL,
    image_link: p.image_url,
    brand: BRAND,
    ...(p.category ? { product_type: p.category } : {}),
  };
}

async function runSync(): Promise<SyncResult> {
  const products = await fetchChannelProducts();
  const skipped: string[] = [];
  const requests: any[] = [];

  for (const p of products) {
    // The catalog needs a JPEG/PNG photo; products without one stay out of the catalog.
    if (!SUPPORTED_IMAGE.test(p.image_url || '')) {
      skipped.push(`${p.name}${p.variant ? ` ${p.variant}` : ''}`);
      continue;
    }
    requests.push({ method: 'UPDATE', data: catalogItem(p) });
  }

  // Products deleted from Inventory, moved to the counter, or without a photo are removed.
  const keep = new Set(requests.map((r) => r.data.id));
  const stale = (await fetchCatalogRetailerIds()).filter((id) => !keep.has(id));
  for (const id of stale) requests.push({ method: 'DELETE', data: { id } });

  for (let i = 0; i < requests.length; i += 1000) {
    const res = await axios.post(
      `${GRAPH_URL}/${CATALOG_ID}/items_batch`,
      { item_type: 'PRODUCT_ITEM', allow_upsert: true, requests: requests.slice(i, i + 1000) },
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, timeout: 30000 }
    );
    const errors = res.data.validation_status?.filter((v: any) => v.errors?.length) || [];
    if (errors.length) console.warn('⚠️ Catalog item errors:', JSON.stringify(errors));
  }

  if (skipped.length) console.warn(`⚠️ Not in catalog (no JPEG/PNG photo): ${skipped.join(', ')}`);
  return { synced: keep.size, removed: stale.length, skipped };
}

export async function syncCatalog(): Promise<SyncResult> {
  if (!CATALOG_ID) return { synced: 0, removed: 0, skipped: [] };
  if (!syncing) {
    syncing = runSync()
      .then((result) => {
        lastSyncAt = Date.now();
        console.log(`🗂️ Catalog synced: ${result.synced} products, ${result.removed} removed`);
        return result;
      })
      .finally(() => {
        syncing = null;
      });
  }
  return syncing;
}

// Called before showing products so prices and stock in WhatsApp follow Inventory closely.
export function syncCatalogIfStale() {
  if (!CATALOG_ID || syncing || Date.now() - lastSyncAt < STALE_AFTER_MS) return;
  syncCatalog().catch((error) => console.error('❌ Catalog sync failed:', error.response?.data || error.message));
}

export function startCatalogSync() {
  if (!CATALOG_ID) {
    console.log('ℹ️ WHATSAPP_CATALOG_ID not set: using the plain product list');
    return;
  }
  syncCatalogIfStale();
  setInterval(syncCatalogIfStale, SYNC_INTERVAL_MS).unref();
}

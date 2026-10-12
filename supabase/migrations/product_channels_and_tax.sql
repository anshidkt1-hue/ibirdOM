-- Separate WhatsApp/online and counter inventories, and record tax per order line.
-- Safe to re-run; non-destructive.

-- sales_channel: 'online' = WhatsApp catalogue, 'counter' = Counter Sale.
-- Products that exist before this runs were the WhatsApp catalogue, so they start as 'online';
-- new products default to 'counter' unless chosen otherwise in Inventory.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'sales_channel'
  ) THEN
    ALTER TABLE public.products ADD COLUMN sales_channel text NOT NULL DEFAULT 'online';
    ALTER TABLE public.products ALTER COLUMN sales_channel SET DEFAULT 'counter';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sales_channel_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_sales_channel_check CHECK (sales_channel IN ('counter', 'online'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_channel_active ON public.products (sales_channel, active, name);

-- Per-product GST (already present on most databases)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gst numeric NOT NULL DEFAULT 5;

-- Tax recorded on each order line
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0;

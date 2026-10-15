-- Invoices (separate series for WhatsApp orders and counter sales) and the giveaway coupon module.
-- Safe to re-run; non-destructive.

-- 1. Business details printed on invoices (the Settings page reads/writes this table)
CREATE TABLE IF NOT EXISTS public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text,
  company_email text,
  company_phone text,
  company_website text,
  company_address text,
  company_description text,
  tax_rate numeric(5, 2) DEFAULT 5.00,
  tax_id text,
  registration_number text,
  discount_type text DEFAULT 'fixed',
  currency text DEFAULT 'INR',
  timezone text DEFAULT 'Asia/Kolkata',
  date_format text DEFAULT 'DD-MM-YYYY',
  language text DEFAULT 'en',
  low_stock_threshold integer DEFAULT 10,
  enable_email_notifications boolean DEFAULT false,
  enable_sms_notifications boolean DEFAULT false,
  enable_low_stock_alerts boolean DEFAULT true,
  whatsapp_api_key text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS giveaway_image_url text;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "demo open access settings" ON public.settings;
CREATE POLICY "demo open access settings" ON public.settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
INSERT INTO public.settings (company_name, company_website)
SELECT 'ibird', 'https://ibirdhomes.com/'
WHERE NOT EXISTS (SELECT 1 FROM public.settings);

-- 2. Invoices: one per paid order, numbered per channel, e.g. WA/2627/000001 and CS/2627/000001
--    (GST invoice numbers: max 16 characters, unique within the financial year)
CREATE SEQUENCE IF NOT EXISTS public.invoice_whatsapp_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.invoice_counter_seq START 1;

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'counter')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  customer_name text,
  customer_phone text,
  billing_address text,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  discount numeric(12, 2) NOT NULL DEFAULT 0,
  tax numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  seller jsonb NOT NULL DEFAULT '{}'::jsonb,   -- business details as they were when issued
  pdf_url text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_channel_issued_idx ON public.invoices (channel, issued_at DESC);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "demo open access invoices" ON public.invoices;
CREATE POLICY "demo open access invoices" ON public.invoices FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Financial year label, e.g. 2627 for Apr 2026 - Mar 2027 (India time)
CREATE OR REPLACE FUNCTION public.invoice_fy_label(ts timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN extract(month FROM ts AT TIME ZONE 'Asia/Kolkata') >= 4
    THEN to_char(ts AT TIME ZONE 'Asia/Kolkata', 'YY') || to_char((ts AT TIME ZONE 'Asia/Kolkata') + interval '1 year', 'YY')
    ELSE to_char((ts AT TIME ZONE 'Asia/Kolkata') - interval '1 year', 'YY') || to_char(ts AT TIME ZONE 'Asia/Kolkata', 'YY')
  END
$$;

-- Creates the invoice for an order once (idempotent; safe under concurrent calls)
CREATE OR REPLACE FUNCTION public.ensure_invoice(p_order_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices;
  v_order public.orders;
  v_channel text;
  v_seq bigint;
  v_seller jsonb;
  v_address text;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE order_id = p_order_id;
  IF FOUND THEN RETURN v_invoice; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Serialise invoice creation per order so two callers cannot both number it
  PERFORM pg_advisory_xact_lock(hashtext('invoice:' || p_order_id::text));
  SELECT * INTO v_invoice FROM public.invoices WHERE order_id = p_order_id;
  IF FOUND THEN RETURN v_invoice; END IF;

  v_channel := CASE WHEN v_order.source = 'whatsapp' THEN 'whatsapp' ELSE 'counter' END;
  v_seq := CASE WHEN v_channel = 'whatsapp' THEN nextval('public.invoice_whatsapp_seq') ELSE nextval('public.invoice_counter_seq') END;

  SELECT jsonb_build_object(
    'name', coalesce(nullif(s.company_name, ''), 'ibird'),
    'address', s.company_address,
    'phone', s.company_phone,
    'email', s.company_email,
    'website', s.company_website,
    'gstin', s.tax_id
  ) INTO v_seller
  FROM public.settings s ORDER BY s.created_at LIMIT 1;

  SELECT c.address INTO v_address FROM public.customers c WHERE c.id = v_order.customer_id;

  INSERT INTO public.invoices (
    invoice_number, order_id, channel, issued_at, customer_name, customer_phone, billing_address,
    subtotal, discount, tax, total, seller
  ) VALUES (
    CASE WHEN v_channel = 'whatsapp' THEN 'WA' ELSE 'CS' END || '/' || public.invoice_fy_label(now()) || '/' || lpad(v_seq::text, 6, '0'),
    v_order.id, v_channel, now(), v_order.customer_name, v_order.customer_phone,
    coalesce(nullif(v_order.delivery_address, ''), v_address),
    coalesce(v_order.subtotal, 0), coalesce(v_order.discount, 0), coalesce(v_order.tax, 0), coalesce(v_order.total, 0),
    coalesce(v_seller, '{"name":"ibird"}'::jsonb)
  )
  ON CONFLICT (order_id) DO NOTHING
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    SELECT * INTO v_invoice FROM public.invoices WHERE order_id = p_order_id;
  END IF;
  RETURN v_invoice;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_invoice(uuid) TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.invoice_whatsapp_seq, public.invoice_counter_seq TO service_role;

-- Every order gets its invoice the moment it is paid (counter sales at once, WhatsApp on payment)
CREATE OR REPLACE FUNCTION public.orders_issue_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status = 'paid' THEN
    PERFORM public.ensure_invoice(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_issue_invoice ON public.orders;
CREATE TRIGGER orders_issue_invoice
AFTER INSERT OR UPDATE OF payment_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_issue_invoice();

-- Backfill invoices for orders that were already paid (oldest first, so numbers follow order dates)
SELECT public.ensure_invoice(o.id) FROM public.orders o
WHERE o.payment_status IN ('paid', 'refunded')
  AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = o.id)
ORDER BY o.created_at;
-- Backfilled invoices carry their order's date (rows inserted by this run have created_at = now())
UPDATE public.invoices i SET issued_at = o.created_at
FROM public.orders o
WHERE o.id = i.order_id AND i.created_at = now();

-- 3. Coupons module: the coupon image sent on WhatsApp and when it was sent
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS sent_at timestamptz;
CREATE INDEX IF NOT EXISTS coupons_created_idx ON public.coupons (created_at DESC);
-- The dashboard reads coupons like every other table (it could not see them before)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "demo open access coupons" ON public.coupons;
CREATE POLICY "demo open access coupons" ON public.coupons FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4. Public bucket for invoice PDFs and coupon images sent on WhatsApp
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Products sold on WhatsApp and at the counter from one stock, and the Thar ROXX offer flag.
-- Safe to re-run; non-destructive.

-- sales_channel: 'online' = WhatsApp only, 'counter' = Counter Sale only, 'both' = both (one stock)
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sales_channel_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_sales_channel_check CHECK (sales_channel IN ('counter', 'online', 'both'));

-- Offer products give one giveaway coupon per unit sold, on WhatsApp and at the counter
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS giveaway_coupon boolean NOT NULL DEFAULT false;

-- Coupons are issued only for units of offer products
CREATE OR REPLACE FUNCTION public.issue_giveaway_coupons(
  p_order_id uuid,
  p_campaign text DEFAULT 'thar-roxx-giveaway'
)
RETURNS SETOF public.coupons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I/L
  v_customer uuid;
  v_total integer;
  v_seq integer := 0;
  v_item record;
  v_unit integer;
  v_code text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('coupons:' || p_order_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.coupons WHERE order_id = p_order_id AND campaign = p_campaign) THEN
    SELECT customer_id INTO v_customer FROM public.orders WHERE id = p_order_id;

    SELECT coalesce(sum(oi.quantity), 0) INTO v_total
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id AND p.giveaway_coupon;

    FOR v_item IN
      SELECT oi.product_id, oi.product_name, oi.quantity
      FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id AND p.giveaway_coupon
      ORDER BY oi.product_name, oi.id
    LOOP
      FOR v_unit IN 1..greatest(v_item.quantity, 0) LOOP
        v_seq := v_seq + 1;
        LOOP
          v_code := 'THAR-' || (
            SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
            FROM generate_series(1, 6)
          );
          BEGIN
            INSERT INTO public.coupons (
              customer_id, order_id, coupon_code, discount_percentage, campaign,
              product_id, product_name, coupon_seq, coupon_total
            ) VALUES (
              v_customer, p_order_id, v_code, 0, p_campaign,
              v_item.product_id, v_item.product_name, v_seq, v_total
            );
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            -- the random code already exists: draw another
          END;
        END LOOP;
      END LOOP;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT * FROM public.coupons
    WHERE order_id = p_order_id AND campaign = p_campaign
    ORDER BY coupon_seq;
END;
$$;
-- The dashboard issues coupons for counter sales; the WhatsApp backend for paid WhatsApp orders
GRANT EXECUTE ON FUNCTION public.issue_giveaway_coupons(uuid, text) TO anon, authenticated, service_role;

-- The Non Stick Ceramic range: sold on WhatsApp and at the counter, and part of the offer
UPDATE public.products
SET sales_channel = 'both', giveaway_coupon = true
WHERE active AND (lower(name) LIKE 'non stick ceramic%' OR lower(name) LIKE 'non-stick ceramic%');

-- Walk-in counter customers have no customer record; their coupons are tied to the sale
ALTER TABLE public.coupons ALTER COLUMN customer_id DROP NOT NULL;

-- Which sales channel issued each giveaway coupon (WhatsApp order or counter sale). Safe to re-run.

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS channel text;

-- Existing coupons: from their order; the earliest coupons (no order) came from the WhatsApp bot
UPDATE public.coupons c
SET channel = CASE WHEN o.source = 'whatsapp' THEN 'whatsapp' ELSE 'counter' END
FROM public.orders o
WHERE c.order_id = o.id AND c.channel IS NULL;
UPDATE public.coupons SET channel = 'whatsapp' WHERE channel IS NULL;

ALTER TABLE public.coupons ALTER COLUMN channel SET DEFAULT 'whatsapp';
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_channel_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_channel_check CHECK (channel IN ('whatsapp', 'counter'));
CREATE INDEX IF NOT EXISTS coupons_channel_created_idx ON public.coupons (channel, created_at DESC);

-- New coupons take the channel of their order
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
  v_channel text;
  v_total integer;
  v_seq integer := 0;
  v_item record;
  v_unit integer;
  v_code text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('coupons:' || p_order_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.coupons WHERE order_id = p_order_id AND campaign = p_campaign) THEN
    SELECT customer_id, CASE WHEN source = 'whatsapp' THEN 'whatsapp' ELSE 'counter' END
      INTO v_customer, v_channel
    FROM public.orders WHERE id = p_order_id;

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
              product_id, product_name, coupon_seq, coupon_total, channel
            ) VALUES (
              v_customer, p_order_id, v_code, 0, p_campaign,
              v_item.product_id, v_item.product_name, v_seq, v_total, coalesce(v_channel, 'whatsapp')
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
GRANT EXECUTE ON FUNCTION public.issue_giveaway_coupons(uuid, text) TO anon, authenticated, service_role;

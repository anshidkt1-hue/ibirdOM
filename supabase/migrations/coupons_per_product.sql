-- Giveaway coupons per product: one coupon for every product unit in a paid order,
-- linked to the product and numbered within the order (1 of N). Safe to re-run.

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS coupon_seq integer;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS coupon_total integer;

-- Coupons issued before this change: one per order
UPDATE public.coupons SET coupon_seq = 1, coupon_total = 1
WHERE order_id IS NOT NULL AND coupon_seq IS NULL;

-- An order now has several coupons, unique by their number within the order
DROP INDEX IF EXISTS public.uq_coupons_order_campaign;
CREATE UNIQUE INDEX IF NOT EXISTS uq_coupons_order_campaign_seq
  ON public.coupons (order_id, campaign, coupon_seq) WHERE order_id IS NOT NULL;

-- Issues the coupons of a paid order once (idempotent; safe when the payment callback and webhook race)
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
    SELECT coalesce(sum(quantity), 0) INTO v_total FROM public.order_items WHERE order_id = p_order_id;

    FOR v_item IN
      SELECT product_id, product_name, quantity FROM public.order_items
      WHERE order_id = p_order_id ORDER BY product_name, id
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
GRANT EXECUTE ON FUNCTION public.issue_giveaway_coupons(uuid, text) TO service_role;

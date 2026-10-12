-- High-volume support: fast filtering/search, race-free order numbers, webhook de-dup, dashboard summary

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Order list: ordering, filters, joins
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_source_created ON public.orders (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_created ON public.orders (assigned_to, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);

-- Substring search (order number / customer name / phone)
CREATE INDEX IF NOT EXISTS idx_orders_number_trgm ON public.orders USING gin (order_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm ON public.orders USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_trgm ON public.orders USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON public.order_status_history (order_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_orders_order_id ON public.whatsapp_orders (order_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_orders_phone_created ON public.whatsapp_orders (phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_created ON public.whatsapp_messages (phone_number, created_at DESC);

-- Webhook de-duplication: Meta re-delivers events, which must not create duplicate orders/replies
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS wa_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_wa_message_id
  ON public.whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- Collision-free order numbers (replaces millisecond-based numbers that can clash under load)
CREATE SEQUENCE IF NOT EXISTS public.whatsapp_order_seq START 100001;

CREATE OR REPLACE FUNCTION public.next_whatsapp_order_number()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'WA-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD') || '-' ||
         lpad(nextval('public.whatsapp_order_seq')::text, 6, '0')
$$;

GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_order_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.next_whatsapp_order_number() TO service_role;

-- Atomic stock deduction for a paid order (a single statement, safe under concurrent payments)
CREATE OR REPLACE FUNCTION public.apply_order_stock(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_number text;
BEGIN
  SELECT order_number INTO v_number FROM public.orders WHERE id = p_order_id;

  INSERT INTO public.stock_movements (product_id, product_name, movement_type, quantity, note)
  SELECT product_id, max(product_name), 'sale', -sum(quantity), 'Order ' || v_number
  FROM public.order_items
  WHERE order_id = p_order_id AND product_id IS NOT NULL
  GROUP BY product_id;

  UPDATE public.products p
  SET stock = greatest(p.stock - s.qty, 0)
  FROM (
    SELECT product_id, sum(quantity) AS qty
    FROM public.order_items
    WHERE order_id = p_order_id AND product_id IS NOT NULL
    GROUP BY product_id
  ) s
  WHERE p.id = s.product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_order_stock(uuid) TO service_role;

-- Dashboard summary computed in the database, so the page never downloads every order
CREATE OR REPLACE FUNCTION public.dashboard_stats(days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total_count',     (SELECT count(*) FROM public.orders),
    'pending_count',   (SELECT count(*) FROM public.orders WHERE status = 'pending'),
    'completed_count', (SELECT count(*) FROM public.orders WHERE status = 'completed'),
    'revenue',         (SELECT coalesce(sum(total), 0) FROM public.orders WHERE status = 'completed'),
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'total', coalesce(s.total, 0)) ORDER BY d.day), '[]'::jsonb)
      FROM (
        SELECT generate_series(
                 (now() AT TIME ZONE 'Asia/Kolkata')::date - (days - 1),
                 (now() AT TIME ZONE 'Asia/Kolkata')::date,
                 interval '1 day')::date AS day
      ) d
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(total) AS total
        FROM public.orders
        WHERE status = 'completed'
          AND created_at >= now() - make_interval(days => days + 1)
        GROUP BY 1
      ) s ON s.day = d.day
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_stats(integer) TO anon, authenticated, service_role;

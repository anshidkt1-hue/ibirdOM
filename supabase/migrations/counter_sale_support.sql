-- Counter sale (in-store POS) support. Safe to re-run; non-destructive.

-- Collision-free counter sale numbers, e.g. CS-261013-100001
CREATE SEQUENCE IF NOT EXISTS public.counter_order_seq START 100001;

CREATE OR REPLACE FUNCTION public.next_counter_order_number()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'CS-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD') || '-' ||
         lpad(nextval('public.counter_order_seq')::text, 6, '0')
$$;

GRANT USAGE, SELECT ON SEQUENCE public.counter_order_seq TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_counter_order_number() TO anon, authenticated, service_role;

-- The dashboard calls the same atomic stock deduction the WhatsApp backend uses
GRANT EXECUTE ON FUNCTION public.apply_order_stock(uuid) TO anon, authenticated;

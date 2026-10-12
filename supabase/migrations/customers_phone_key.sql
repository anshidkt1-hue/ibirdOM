-- One customer per phone number: match on the last 10 digits (ignores +91, spaces, leading 0).
-- Non-destructive: adds columns and a lookup index only.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) STORED;

CREATE INDEX IF NOT EXISTS idx_customers_phone_key ON public.customers (phone_key);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON public.customers (created_at DESC);

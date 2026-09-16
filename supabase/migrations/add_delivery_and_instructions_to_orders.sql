-- Add delivery_address and special_instructions columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_instructions TEXT;

-- Add comment to document these columns
COMMENT ON COLUMN orders.delivery_address IS 'Delivery address for the order (especially for WhatsApp orders)';
COMMENT ON COLUMN orders.special_instructions IS 'Special cooking instructions, customization requests, or order notes';

-- Ensure customer_id can be NULL for walk-in orders
ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;

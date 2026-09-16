-- Add image_url column to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN products.image_url IS 'URL of the product image stored in Supabase storage';

-- Add HSN Code and GST columns to products table
ALTER TABLE public.products
ADD COLUMN hsn_code text,
ADD COLUMN gst numeric NOT NULL DEFAULT 5;

-- Add comment for documentation
COMMENT ON COLUMN public.products.hsn_code IS 'Harmonized System of Nomenclature code for tax classification';
COMMENT ON COLUMN public.products.gst IS 'Goods and Services Tax rate as percentage (e.g., 5, 12, 18)';

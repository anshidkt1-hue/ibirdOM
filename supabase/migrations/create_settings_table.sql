-- Create settings table for business configuration
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Company Information
  company_name TEXT,
  company_email TEXT,
  company_phone TEXT,
  company_website TEXT,
  company_address TEXT,
  company_description TEXT,

  -- Tax & Pricing
  tax_rate DECIMAL(5, 2) DEFAULT 5.00,
  tax_id TEXT,
  registration_number TEXT,
  discount_type TEXT DEFAULT 'fixed',

  -- Localization
  currency TEXT DEFAULT 'INR',
  timezone TEXT DEFAULT 'Asia/Kolkata',
  date_format TEXT DEFAULT 'DD-MM-YYYY',
  language TEXT DEFAULT 'en',

  -- Features & Notifications
  low_stock_threshold INTEGER DEFAULT 10,
  enable_email_notifications BOOLEAN DEFAULT false,
  enable_sms_notifications BOOLEAN DEFAULT false,
  enable_low_stock_alerts BOOLEAN DEFAULT true,

  -- API Keys
  whatsapp_api_key TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index on created_at for quick lookups
CREATE INDEX idx_settings_created_at ON settings(created_at);

-- Enable RLS on settings table
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for settings
-- Allow authenticated users to view settings
CREATE POLICY "allow_authenticated_view_settings"
ON settings FOR SELECT
TO authenticated
USING (true);

-- Allow only admin users to update settings
CREATE POLICY "allow_authenticated_update_settings"
ON settings FOR UPDATE
TO authenticated
USING (auth.jwt() ->> 'user_role' = 'admin')
WITH CHECK (auth.jwt() ->> 'user_role' = 'admin');

-- Allow only admin users to insert settings
CREATE POLICY "allow_authenticated_insert_settings"
ON settings FOR INSERT
TO authenticated
WITH CHECK (auth.jwt() ->> 'user_role' = 'admin');

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settings_updated_at_trigger
BEFORE UPDATE ON settings
FOR EACH ROW
EXECUTE FUNCTION update_settings_updated_at();

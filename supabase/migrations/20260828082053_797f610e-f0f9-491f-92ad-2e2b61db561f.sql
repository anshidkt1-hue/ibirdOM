
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  city text,
  state text,
  customer_type text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO anon, authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo open access customers" ON public.customers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text NOT NULL UNIQUE,
  barcode text,
  category text NOT NULL DEFAULT 'General',
  variant text,
  cost_price numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 10,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo open access products" ON public.products FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT 'Walk-in Customer',
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending',
  payment_method text NOT NULL DEFAULT 'cash',
  payment_status text NOT NULL DEFAULT 'unpaid',
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  refund_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO anon, authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo open access orders" ON public.orders FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  sku text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO anon, authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo open access order_items" ON public.order_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL DEFAULT 'staff',
  department text,
  salary numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  join_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO anon, authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo open access employees" ON public.employees FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  movement_type text NOT NULL DEFAULT 'adjustment',
  quantity integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO anon, authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo open access stock_movements" ON public.stock_movements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.products (name, sku, barcode, category, variant, cost_price, price, stock, low_stock_threshold) VALUES
('Cotton Kurta','IB-APP-001','8901234500011','Apparel','Blue / M',620,1299,48,10),
('Cotton Kurta','IB-APP-002','8901234500028','Apparel','White / L',620,1299,6,10),
('Linen Shirt','IB-APP-003','8901234500035','Apparel','Beige / M',890,1899,23,8),
('Silk Saree','IB-APP-004','8901234500042','Apparel','Maroon',2400,5499,12,5),
('Leather Wallet','IB-ACC-001','8901234500059','Accessories','Brown',420,999,64,15),
('Canvas Tote Bag','IB-ACC-002','8901234500066','Accessories','Natural',260,699,4,12),
('Beaded Necklace','IB-ACC-003','8901234500073','Accessories','Gold',310,899,31,10),
('Scented Candle','IB-HOM-001','8901234500080','Home','Vanilla',150,449,80,20),
('Ceramic Mug Set','IB-HOM-002','8901234500097','Home','Set of 4',540,1249,9,10),
('Handwoven Rug','IB-HOM-003','8901234500103','Home','5x7 ft',3200,7499,7,4),
('Organic Green Tea','IB-GRO-001','8901234500110','Grocery','250g',180,399,120,25),
('Cold Pressed Oil','IB-GRO-002','8901234500127','Grocery','1L',210,499,3,15),
('Bluetooth Earbuds','IB-ELE-001','8901234500134','Electronics','Black',1450,2999,26,8),
('Power Bank 10000mAh','IB-ELE-002','8901234500141','Electronics','Grey',890,1799,2,8),
('Desk Lamp','IB-ELE-003','8901234500158','Electronics','Warm White',720,1599,18,6);

INSERT INTO public.customers (name, phone, email, city, state, customer_type) VALUES
('Anshid K T','+91 98470 11223','anshid@example.com','Kozhikode','Kerala','repeat'),
('Meera Nair','+91 99461 55210','meera@example.com','Kochi','Kerala','repeat'),
('Rahul Sharma','+91 98110 22334','rahul@example.com','New Delhi','Delhi','new'),
('Fathima Rizwan','+91 97450 88112','fathima@example.com','Malappuram','Kerala','repeat'),
('Arjun Menon','+91 90370 44556','arjun@example.com','Bengaluru','Karnataka','new'),
('Priya Iyer','+91 98840 77009','priya@example.com','Chennai','Tamil Nadu','repeat'),
('Sandeep Verma','+91 99300 12045','sandeep@example.com','Mumbai','Maharashtra','new'),
('Nithya Raj','+91 94470 33221','nithya@example.com','Thrissur','Kerala','repeat'),
('Vikram Patel','+91 98250 66778','vikram@example.com','Ahmedabad','Gujarat','new'),
('Aisha Khan','+91 90040 99881','aisha@example.com','Hyderabad','Telangana','repeat'),
('Walk-in Customer',NULL,NULL,'Kozhikode','Kerala','new'),
('Joseph Thomas','+91 94960 12378','joseph@example.com','Kottayam','Kerala','new');

INSERT INTO public.employees (name, email, phone, role, department, salary, status, join_date) VALUES
('Anshid K T','anshid@ibird.com','+91 98470 11223','admin','Management',85000,'active','2023-01-15'),
('Meera Nair','meera@ibird.com','+91 99461 55210','manager','Sales',56000,'active','2023-04-02'),
('Rahul Sharma','rahul@ibird.com','+91 98110 22334','staff','Sales',32000,'active','2024-02-11'),
('Fathima Rizwan','fathima@ibird.com','+91 97450 88112','staff','Inventory',30000,'active','2024-06-20'),
('Arjun Menon','arjun@ibird.com','+91 90370 44556','viewer','Accounts',28000,'active','2025-01-08'),
('Nithya Raj','nithya@ibird.com','+91 94470 33221','staff','Support',29500,'on_leave','2024-09-01');

DO $$
DECLARE
  i int;
  o_id uuid;
  cust record;
  prod record;
  n_items int;
  q int;
  sub numeric;
  disc numeric;
  tx numeric;
  st text;
  src text;
  pm text;
  created timestamptz;
BEGIN
  FOR i IN 1..70 LOOP
    SELECT * INTO cust FROM public.customers ORDER BY random() LIMIT 1;
    created := now() - (random() * 89 || ' days')::interval;
    st := (ARRAY['completed','completed','completed','completed','pending','processing','shipped','cancelled'])[1 + floor(random()*8)::int];
    src := (ARRAY['whatsapp','whatsapp','whatsapp','walk-in','manual'])[1 + floor(random()*5)::int];
    pm := (ARRAY['cash','card','upi'])[1 + floor(random()*3)::int];
    sub := 0;
    INSERT INTO public.orders (order_number, customer_id, customer_name, source, status, payment_method, payment_status, subtotal, discount, tax, total, created_at, updated_at)
    VALUES ('IB-' || lpad((1000 + i)::text, 4, '0'), cust.id, cust.name, src, st, pm,
      CASE WHEN st = 'completed' THEN 'paid' WHEN st = 'cancelled' THEN 'refunded' ELSE 'unpaid' END,
      0,0,0,0, created, created)
    RETURNING id INTO o_id;

    n_items := 1 + floor(random()*3)::int;
    FOR prod IN SELECT * FROM public.products ORDER BY random() LIMIT n_items LOOP
      q := 1 + floor(random()*3)::int;
      INSERT INTO public.order_items (order_id, product_id, product_name, sku, quantity, unit_price, line_total, created_at)
      VALUES (o_id, prod.id, prod.name, prod.sku, q, prod.price, prod.price * q, created);
      sub := sub + prod.price * q;
    END LOOP;

    disc := round((CASE WHEN random() < 0.3 THEN sub * 0.05 ELSE 0 END)::numeric, 2);
    tx := round(((sub - disc) * 0.05)::numeric, 2);
    UPDATE public.orders SET subtotal = sub, discount = disc, tax = tx, total = sub - disc + tx,
      refund_amount = CASE WHEN st = 'cancelled' THEN sub - disc + tx ELSE 0 END
    WHERE id = o_id;
  END LOOP;
END $$;

INSERT INTO public.stock_movements (product_id, product_name, movement_type, quantity, note)
SELECT id, name, 'restock', 25, 'Opening stock received' FROM public.products LIMIT 8;

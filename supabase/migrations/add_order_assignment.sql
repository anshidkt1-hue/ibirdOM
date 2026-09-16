-- Add order assignment support
ALTER TABLE public.orders
ADD COLUMN assigned_to uuid REFERENCES public.employees(id) ON DELETE SET NULL,
ADD COLUMN assigned_at timestamptz,
ADD COLUMN assigned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_orders_assigned_to ON public.orders(assigned_to);
CREATE INDEX idx_orders_status_assigned ON public.orders(status, assigned_to);

-- Add comments for documentation
COMMENT ON COLUMN public.orders.assigned_to IS 'Employee ID this order is assigned to';
COMMENT ON COLUMN public.orders.assigned_at IS 'When the order was assigned';
COMMENT ON COLUMN public.orders.assigned_by IS 'Employee ID who made the assignment (Admin/Manager)';

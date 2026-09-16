-- Create order status history table
CREATE TABLE public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_at timestamptz DEFAULT now(),
  changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create order assignment history table
CREATE TABLE public.order_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_assigned_to uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  new_assigned_to uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for faster lookups
CREATE INDEX idx_order_status_history_order_id ON public.order_status_history(order_id);
CREATE INDEX idx_order_status_history_changed_at ON public.order_status_history(changed_at);
CREATE INDEX idx_order_assignment_history_order_id ON public.order_assignment_history(order_id);
CREATE INDEX idx_order_assignment_history_assigned_at ON public.order_assignment_history(assigned_at);

-- Add comments for documentation
COMMENT ON TABLE public.order_status_history IS 'Track all status changes for orders';
COMMENT ON TABLE public.order_assignment_history IS 'Track all assignment changes for orders';
COMMENT ON COLUMN public.order_status_history.changed_by IS 'Employee who made the status change';
COMMENT ON COLUMN public.order_assignment_history.assigned_by IS 'Employee (Admin/Manager) who made the assignment';

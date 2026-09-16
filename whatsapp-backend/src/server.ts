import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';

// Import routes
import whatsappRoutes from './routes/whatsapp.routes';
import ordersRoutes from './routes/orders.routes';
import paymentsRoutes from './routes/payments.routes';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// ============================================
// SUPABASE CLIENT
// ============================================

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

console.log('✅ Supabase connected');

// ============================================
// ROUTES
// ============================================

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// WhatsApp Routes
app.use('/api/whatsapp', whatsappRoutes);

// Orders Routes
app.use('/api/orders', ordersRoutes);

// Payments Routes
app.use('/api/payments', paymentsRoutes);

// ============================================
// ERROR HANDLER
// ============================================

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    error: err.message,
    timestamp: new Date(),
  });
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🚀 WhatsApp Backend Server Started   ║
║  Port: ${PORT}
║  Environment: ${process.env.NODE_ENV}
║  WhatsApp Phone ID: ${process.env.WHATSAPP_PHONE_NUMBER_ID}
║
║  Available Routes:
║  ✅ GET  /health
║  ✅ GET  /api/whatsapp/webhook (verify)
║  ✅ POST /api/whatsapp/webhook (events)
║  ✅ POST /api/orders/create-from-whatsapp
║  ✅ GET  /api/orders/:orderId/status
║  ✅ PUT  /api/orders/:orderId/status
║  ✅ POST /api/payments/verify-razorpay
║  ✅ POST /api/payments/razorpay-webhook
║
╚════════════════════════════════════════╝
  `);
});

export default app;
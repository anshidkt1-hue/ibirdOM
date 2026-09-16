import { Router } from 'express';
import {
  createOrderFromWhatsApp,
  getOrderStatus,
  updateOrderStatus,
} from '../controllers/ordersController';

const router = Router();

// Create order from WhatsApp
router.post('/create-from-whatsapp', createOrderFromWhatsApp);

// Get order status
router.get('/:orderId/status', getOrderStatus);

// Update order status
router.put('/:orderId/status', updateOrderStatus);

export default router;
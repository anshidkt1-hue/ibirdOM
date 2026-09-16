import { Router, Request, Response } from 'express';
import {
  verifyWebhookToken,
  handleIncomingMessage,
  handleMessageStatus,
} from '../controllers/whatsappController';

const router = Router();

// Webhook Verification (GET)
router.get('/webhook', verifyWebhookToken);

// Webhook Events (POST)
router.post('/webhook', handleIncomingMessage);

// Message Status Updates (POST)
router.post('/webhook/status', handleMessageStatus);

export default router;
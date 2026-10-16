import { Router, Request, Response } from 'express';
import {
  verifyWebhookToken,
  handleIncomingMessage,
  handleMessageStatus,
} from '../controllers/whatsappController';
import { syncCatalog } from '../services/catalogService';
import { sendInboxReply } from '../controllers/inboxController';

const router = Router();

// Webhook Verification (GET)
router.get('/webhook', verifyWebhookToken);

// Webhook Events (POST)
router.post('/webhook', handleIncomingMessage);

// Message Status Updates (POST)
router.post('/webhook/status', handleMessageStatus);

// Push Inventory to the WhatsApp catalog now (it also syncs every 10 minutes on its own)
router.post('/catalog/sync', async (_req: Request, res: Response) => {
  try {
    res.json(await syncCatalog());
  } catch (error: any) {
    res.status(502).json({ error: error.response?.data?.error?.message || error.message });
  }
});

// Staff reply from the dashboard WhatsApp inbox
router.post('/inbox/send', sendInboxReply);

export default router;
import { Router, Request, Response } from 'express';
import {
  verifyPaymentSignature,
  verifyPaymentLinkSignature,
  verifyWebhookSignature,
  handlePaymentSuccess,
} from '../services/razorpayService';

const router = Router();

const page = (title: string, message: string) =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:sans-serif;text-align:center;padding:48px 16px"><h2>${title}</h2><p>${message}</p></body></html>`;

// Razorpay redirects the customer here after paying a payment link
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const linkId = q.razorpay_payment_link_id;
    const refId = q.razorpay_payment_link_reference_id || '';
    const status = q.razorpay_payment_link_status;
    const paymentId = q.razorpay_payment_id;
    const signature = q.razorpay_signature;

    if (!linkId || !status || !paymentId || !signature) {
      return res.status(400).send(page('Invalid request', 'Missing payment details.'));
    }

    if (!verifyPaymentLinkSignature(linkId, refId, status, paymentId, signature)) {
      console.log('❌ Invalid payment link signature');
      return res.status(400).send(page('Invalid payment', 'Signature verification failed.'));
    }

    if (status === 'paid') {
      await handlePaymentSuccess(linkId, paymentId);
      return res.send(page('Payment successful ✅', 'You can close this page and go back to WhatsApp.'));
    }

    res.send(page('Payment not completed', `Status: ${status}. Please try again from WhatsApp.`));
  } catch (error: any) {
    console.error('❌ Payment callback error:', error);
    res.status(500).send(page('Something went wrong', 'Your payment may still be processed. Check WhatsApp.'));
  }
});

router.post('/verify-razorpay', async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = await verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const result = await handlePaymentSuccess(razorpay_order_id, razorpay_payment_id);
    res.json({ success: true, message: 'Payment verified', couponCode: result.couponCode });
  } catch (error: any) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Razorpay webhook (optional second path; configure event payment_link.paid)
router.post('/razorpay-webhook', async (req: Request, res: Response) => {
  try {
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!verifyWebhookSignature(raw, req.header('x-razorpay-signature'))) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const { event, payload } = req.body;
    console.log(`📊 Razorpay webhook event: ${event}`);

    if (event === 'payment_link.paid') {
      const linkId = payload.payment_link.entity.id;
      const paymentId = payload.payment?.entity?.id;
      await handlePaymentSuccess(linkId, paymentId);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Razorpay webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

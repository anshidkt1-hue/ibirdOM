import { Router, Request, Response } from 'express';
import { verifyPaymentSignature, handlePaymentSuccess } from '../services/razorpayService';

const router = Router();

// Razorpay Payment Verification Webhook
router.post('/verify-razorpay', async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const isValid = await verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      console.log('❌ Invalid payment signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Handle successful payment
    const result = await handlePaymentSuccess({
      razorpay_order_id,
      razorpay_payment_id,
      amount: req.body.amount,
    });

    console.log(`✅ Payment verified for order`);

    res.json({
      success: true,
      message: 'Payment verified',
      couponCode: result.couponCode,
    });
  } catch (error: any) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Razorpay Webhook for payment events
router.post('/razorpay-webhook', async (req: Request, res: Response) => {
  try {
    const { event, payload } = req.body;

    console.log(`📊 Razorpay webhook event: ${event}`);

    if (event === 'payment_link.completed') {
      const { payment_link_id, user_id } = payload.payment_link;
      console.log(`✅ Payment link completed: ${payment_link_id}`);
    } else if (event === 'payment_link.expired') {
      const { payment_link_id } = payload.payment_link;
      console.log(`⏰ Payment link expired: ${payment_link_id}`);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Razorpay webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
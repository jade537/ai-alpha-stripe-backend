const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Configure CORS to allow requests from your Lovable app
app.use(cors({
  origin: process.env.CLIENT_URL || 'https://lovable.app',
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Stripe checkout server is running' });
});

// Coupon IDs (verified from Stripe dashboard)
const COUPON_IDS = {
  '3': 'gX002Orj',  // 10% off for 3+ items
  '5': '91SAvN7y',  // 15% off for 5+ items
  '7': '4kCkHlm0',  // 20% off for 7+ items
  '22': 'BGI8HqEn'  // 30% off for all 22 items
};

// Determine which coupon to apply based on quantity
function getCouponId(itemCount) {
  if (itemCount >= 22) return COUPON_IDS['22'];
  if (itemCount >= 7) return COUPON_IDS['7'];
  if (itemCount >= 5) return COUPON_IDS['5'];
  if (itemCount >= 3) return COUPON_IDS['3'];
  return null; // No discount for 1-2 items
}

// Create checkout session endpoint
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceIds } = req.body;

    if (!priceIds || !Array.isArray(priceIds) || priceIds.length === 0) {
      return res.status(400).json({ error: 'priceIds array is required' });
    }

    // Build line items
    const lineItems = priceIds.map(priceId => ({
      price: priceId,
      quantity: 1
    }));

    // Determine coupon based on item count
    const itemCount = priceIds.length;
    const couponId = getCouponId(itemCount);

    // Create checkout session config
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'subscription',
      success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}`,
      allow_promotion_codes: false // CRITICAL: Never show promo code field
    };

    // Apply coupon automatically if applicable
    if (couponId) {
      sessionConfig.discounts = [{
        coupon: couponId
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint (optional - for handling post-payment events)
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('Checkout session completed:', event.data.object);
        break;
      case 'customer.subscription.created':
        console.log('Subscription created:', event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({received: true});
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

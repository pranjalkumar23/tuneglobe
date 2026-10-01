// Cloud Functions for TuneGlobe's Razorpay subscriptions.
//
// Two callable functions:
//  - createRazorpayOrder: server creates a Razorpay order for a fixed,
//    server-defined amount (never trust a client-supplied price) and hands
//    the client just enough to open Razorpay Checkout.
//  - verifyRazorpayPayment: verifies the HMAC signature Razorpay returns
//    after checkout server-side (the only trustworthy way to confirm a
//    payment actually happened) and then — and only then — activates the
//    subscription in Firestore using the Admin SDK.
//
// These are one-time orders, not Razorpay's auto-recurring "Subscription"
// entity: each purchase extends currentPeriodEnd by the plan's duration
// from whichever is later, now or the existing expiry (so renewing early
// stacks on top instead of wasting the remainder). There's no auto-debit —
// users renew manually. See SETUP.md for why, and how to move to
// auto-recurring billing later if you want it.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const Razorpay = require('razorpay');

admin.initializeApp();

const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');

// Source of truth for pricing/duration — the client only ever sends the
// plan *name*, never an amount.
const PLANS = {
  monthly: { amountPaise: 4900, months: 1 },
  quarterly: { amountPaise: 9900, months: 3 },
  yearly: { amountPaise: 59900, months: 12 },
};

function getRazorpayClient() {
  return new Razorpay({
    key_id: RAZORPAY_KEY_ID.value(),
    key_secret: RAZORPAY_KEY_SECRET.value(),
  });
}

exports.createRazorpayOrder = onCall(
  { secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const plan = request.data?.plan;
    const planConfig = PLANS[plan];
    if (!planConfig) {
      throw new HttpsError('invalid-argument', 'Unknown plan.');
    }

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: planConfig.amountPaise,
      currency: 'INR',
      receipt: `${request.auth.uid}_${plan}_${Date.now()}`,
      notes: { uid: request.auth.uid, plan },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID.value(),
    };
  }
);

exports.verifyRazorpayPayment = onCall(
  { secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in first.');
    }
    const { plan, orderId, paymentId, signature } = request.data || {};
    const planConfig = PLANS[plan];
    if (!planConfig || !orderId || !paymentId || !signature) {
      throw new HttpsError('invalid-argument', 'Missing or invalid payment details.');
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET.value())
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const validSignature =
      expectedSignature.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));

    if (!validSignature) {
      throw new HttpsError('permission-denied', 'Invalid payment signature.');
    }

    const db = admin.firestore();
    const userRef = db.collection('users').doc(request.auth.uid);

    const newPeriodEnd = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const existingEnd = snap.get('currentPeriodEnd');
      const now = admin.firestore.Timestamp.now();
      const base = existingEnd && existingEnd.toMillis() > now.toMillis() ? existingEnd : now;
      const end = new Date(base.toMillis());
      end.setMonth(end.getMonth() + planConfig.months);
      const endTimestamp = admin.firestore.Timestamp.fromDate(end);

      tx.set(
        userRef,
        {
          plan,
          subscriptionStatus: 'active',
          currentPeriodEnd: endTimestamp,
          lastPaymentId: paymentId,
          lastOrderId: orderId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return endTimestamp;
    });

    return { ok: true, currentPeriodEnd: newPeriodEnd.toMillis() };
  }
);

# TuneGlobe: Google login + Razorpay subscriptions — setup

This app now has the code for Google sign-in and paid plans (₹49/mo, ₹99/3mo,
₹599/yr), but it won't do anything until you create two accounts and paste
their credentials into the right places. Nobody but you can do this part —
it involves your own Google Cloud project and your own Razorpay business
account (KYC, bank details).

Everything below is one-time setup. Budget ~30–45 minutes for the Firebase
half, and note that the Razorpay half (KYC) can take a few days to be
approved for **live** payments — but you can build and fully test the whole
flow today using Razorpay's **test mode**, which needs no KYC.

## What you're setting up

- **Firebase**: hosts your Google sign-in and a small database (Firestore)
  that stores each user's subscription status. Free for this scale of app.
- **Razorpay**: processes the actual ₹ payments. Test mode is free and
  instant; live mode (real money) requires KYC approval.
- **Cloud Functions**: the only place your Razorpay secret key lives. It
  creates orders and verifies payments server-side — the app's frontend
  code never sees your secret key or decides on its own that a payment
  succeeded.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it
   (e.g. "tuneglobe") → you can skip Google Analytics.
2. In the left sidebar: **Build → Authentication → Get started**. Under
   "Sign-in method", enable **Google**. Set a support email when asked.
3. **Build → Firestore Database → Create database**. Choose a region close
   to your users (e.g. `asia-south1` for India). Start in **production
   mode** (the rules file in this repo already locks it down correctly).
4. **Project settings** (gear icon) → scroll to "Your apps" → click the
   `</>` web icon → register an app (any nickname) → **don't** check
   Firebase Hosting yet if asked, just get the config object.
5. Copy that config object into [firebase-config.js](firebase-config.js),
   replacing all the `REPLACE_ME` values.
6. Also copy the **Project ID** (visible in Project settings) into
   [.firebaserc](.firebaserc), replacing `REPLACE_ME_FIREBASE_PROJECT_ID`.

## 2. Install the Firebase CLI and link this project

```bash
npm install -g firebase-tools
firebase login
```

Run this from inside the `worldradio` folder — it should pick up the
project id from `.firebaserc` automatically:

```bash
firebase projects:list
```

If that shows your project, you're linked correctly.

## 3. Create a Razorpay account (test mode first)

1. Go to https://dashboard.razorpay.com/signup and sign up.
2. You'll land in **Test Mode** by default — this is exactly what you want
   for now. No KYC needed to test.
3. Go to **Settings → API Keys → Generate Test Key**. You'll get a
   **Key Id** (starts `rzp_test_...`) and a **Key Secret**. Copy both —
   the secret is only shown once.

## 4. Give the Cloud Functions your Razorpay test keys

Cloud Functions secrets are stored by Google, not in any file in this repo
(so they never end up in git or on the client):

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
```

Paste the Test Key Id / Test Key Secret when prompted for each.

## 5. Install function dependencies and deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

This deploys `createRazorpayOrder` and `verifyRazorpayPayment`
([functions/index.js](functions/index.js)) plus the security rules
([firestore.rules](firestore.rules)).

## 6. Run the app and test end-to-end

Serve the site however you already do (e.g. `npx serve worldradio`), open
it, and:

1. Click **Sign in** → sign in with any Google account. You should see
   your avatar appear top-right.
2. Click **⭐ Premium** → pick a plan → Razorpay Checkout should open.
3. Use a [Razorpay test card](https://razorpay.com/docs/payments/payments/test-card-upi-details/)
   (e.g. card `4111 1111 1111 1111`, any future expiry, any CVV) to pay.
4. On success you should see "You are Premium! 🎉" and the Favorites panel
   should stop showing the 5-favorite cap.

If sign-in doesn't show a popup, check the browser console — the most
common cause is the Firebase config still having a `REPLACE_ME` value, or
the domain you're testing on (e.g. `localhost:5301`) not being in
Firebase Console → Authentication → Settings → **Authorized domains**
(add it if missing — `localhost` is usually there by default).

## 7. Going live (real money)

1. In Razorpay, complete **Account & Settings → KYC** with your business
   or individual details and bank account for settlements. This is a
   Razorpay review process — it can take a few days.
2. Once approved, switch Razorpay Dashboard to **Live Mode**, generate a
   **Live** Key Id/Secret, and re-run step 4 with the live values (this
   overwrites the test secrets — Cloud Functions will pick up the new
   values on the next deploy/invocation).
3. That's it — no code changes needed, since the app always reads the
   secret via `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, whichever you set.

## Design choices worth knowing about

- **These are one-time purchases, not auto-recurring subscriptions.** Each
  payment extends `currentPeriodEnd` by the plan's duration; there's no
  auto-debit, so users have to come back and pay again when it lapses.
  This was a deliberate simplification to avoid Razorpay's e-mandate /
  UPI Autopay compliance flow for a first version. If you want true
  auto-renewal later, look at Razorpay's
  [Subscriptions API](https://razorpay.com/docs/payments/subscriptions/) —
  it's a bigger change (recurring mandate setup, a webhook endpoint for
  renewal/failure events) so treat it as a separate follow-up.
- **Favorites are capped at 5 for free users**, unlimited for Premium —
  that's the only gated feature right now (see `FREE_FAVORITES_LIMIT` in
  [app.js](app.js)). Explore/search/play are free for everyone. You can
  change what's gated, or add more gated features, in `app.js`.
- **No webhook yet.** Payment confirmation currently relies on the client
  calling `verifyRazorpayPayment` right after checkout succeeds. This
  covers the normal path well, but if a user closes the tab between
  payment and verification, Razorpay will have their money but Firestore
  won't reflect it. A Razorpay webhook (a second Cloud Function,
  configured in Razorpay Dashboard → Webhooks) would close that gap — flag
  this as a near-term hardening item once you have real users paying.

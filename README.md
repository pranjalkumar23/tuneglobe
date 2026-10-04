# TuneGlobe

Explore and stream live radio stations from anywhere in the world on an interactive map.

**Live at [tuneglobe.netlify.app](https://tuneglobe.netlify.app/)**

## What it does

- Drop a pin anywhere on a world map and stream that region's live radio stations instantly.
- Google sign-in and per-user data via Firebase Auth + Firestore.
- Optional paid plans (₹49/mo, ₹99/3mo, ₹599/yr) processed through Razorpay, with all payment
  verification handled server-side in Cloud Functions — the frontend never sees or decides on a
  payment's success.

## Stack

- Vanilla JS frontend, Leaflet-style interactive map
- Firebase Auth + Firestore for accounts and data
- Firebase Cloud Functions for Razorpay order creation and payment verification
- Firestore security rules locking data down per-user

## Running your own instance

This repo ships with placeholder config (`firebase-config.js`, `.firebaserc`) in the
committed source — the live deployment above uses its own real Firebase and Razorpay
credentials, kept out of version control. See [SETUP.md](SETUP.md) for the full step-by-step
(Firebase project creation, Firestore rules deploy, Cloud Functions secrets, Razorpay test vs.
live mode) if you want to stand up your own copy.

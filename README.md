# TuneGlobe

Explore and stream live radio stations from anywhere in the world on an interactive map.

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

## Setup

This repo ships with placeholder config (`firebase-config.js`, `.firebaserc`) — it won't run until
you connect your own Firebase and Razorpay accounts. See [SETUP.md](SETUP.md) for the full
step-by-step (Firebase project creation, Firestore rules deploy, Cloud Functions secrets, Razorpay
test vs. live mode).

## Why no live demo

The map and station browsing are static, but accounts and subscriptions depend on Firebase Cloud
Functions and a configured Razorpay account — there's no backend to run on GitHub Pages. The
source here is the full implementation; SETUP.md covers standing up your own instance.

// Firebase web config — this is NOT a secret (it's meant to be public/
// client-side), unlike the Razorpay key secret or Firebase service account
// keys, which must only ever live server-side (see functions/index.js and
// SETUP.md). Get these values from:
// Firebase Console -> Project settings -> General -> "Your apps" -> Web app.
const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

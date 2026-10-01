// Google sign-in + Razorpay subscription handling for TuneGlobe.
//
// This file is intentionally decoupled from app.js: it owns auth/billing
// state and exposes a small `TuneGlobe.Auth` API (plus a
// 'tuneglobe:subscription-changed' window event) that app.js consumes to
// decide things like the free-tier favorites cap. See SETUP.md for the
// one-time Firebase + Razorpay account setup this depends on.

const PLAN_LABELS = {
  monthly: 'Monthly (₹49)',
  quarterly: '3 Months (₹99)',
  yearly: '1 Year (₹599)',
};

const btnSignin = document.getElementById('btn-signin');
const btnAccount = document.getElementById('btn-account');
const accountAvatar = document.getElementById('account-avatar');
const accountMenu = document.getElementById('account-menu');
const accountName = document.getElementById('account-name');
const accountPlan = document.getElementById('account-plan');
const btnSignout = document.getElementById('btn-signout');
const btnOpenPremium = document.getElementById('btn-open-premium');
const btnPremium = document.getElementById('btn-premium');
const premiumModal = document.getElementById('premium-modal');
const premiumClose = document.getElementById('premium-close');
const premiumStatus = document.getElementById('premium-status');

let firebaseReady = false;
let currentUser = null;
let subscriptionDoc = null; // { plan, subscriptionStatus, currentPeriodEnd }
let unsubscribeUserDoc = null;

function isConfigured() {
  return typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey !== 'REPLACE_ME';
}

if (isConfigured()) {
  firebase.initializeApp(firebaseConfig);
  firebaseReady = true;
} else {
  console.warn(
    'TuneGlobe: firebase-config.js still has placeholder values — sign-in and premium ' +
    'features are disabled until you fill in a real Firebase project config. See SETUP.md.'
  );
  if (btnSignin) btnSignin.title = 'Sign-in not configured yet (see SETUP.md)';
  if (btnSignin) btnSignin.disabled = true;
  if (btnPremium) btnPremium.disabled = true;
}

function isPremium() {
  if (!subscriptionDoc || subscriptionDoc.subscriptionStatus !== 'active') return false;
  const periodEnd = subscriptionDoc.currentPeriodEnd;
  if (!periodEnd) return false;
  const endMs = typeof periodEnd.toMillis === 'function' ? periodEnd.toMillis() : periodEnd;
  return endMs > Date.now();
}

function notifySubscriptionChanged() {
  window.dispatchEvent(new CustomEvent('tuneglobe:subscription-changed', {
    detail: { user: currentUser, isPremium: isPremium() },
  }));
}

function renderAuthUI() {
  if (currentUser) {
    btnSignin.classList.add('hidden');
    btnAccount.classList.remove('hidden');
    accountAvatar.src = currentUser.photoURL || '';
    if (accountName) accountName.textContent = currentUser.displayName || currentUser.email || 'Account';
    if (accountPlan) accountPlan.textContent = isPremium()
      ? `Premium · ${PLAN_LABELS[subscriptionDoc.plan] || subscriptionDoc.plan}`
      : 'Free plan';
  } else {
    btnSignin.classList.remove('hidden');
    btnAccount.classList.add('hidden');
    accountMenu.classList.add('hidden');
  }
}

async function ensureUserDoc(user) {
  const db = firebase.firestore();
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      email: user.email,
      displayName: user.displayName,
      subscriptionStatus: 'free',
      plan: null,
      currentPeriodEnd: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  if (unsubscribeUserDoc) unsubscribeUserDoc();
  unsubscribeUserDoc = ref.onSnapshot((doc) => {
    subscriptionDoc = doc.data() || null;
    renderAuthUI();
    notifySubscriptionChanged();
  });
}

if (firebaseReady) {
  firebase.auth().onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
      ensureUserDoc(user);
    } else {
      subscriptionDoc = null;
      if (unsubscribeUserDoc) { unsubscribeUserDoc(); unsubscribeUserDoc = null; }
      renderAuthUI();
      notifySubscriptionChanged();
    }
  });
}

btnSignin?.addEventListener('click', async () => {
  if (!firebaseReady) return;
  try {
    await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (err) {
    console.error('Sign-in failed', err);
    alert('Sign-in failed. Please try again.');
  }
});

btnAccount?.addEventListener('click', () => {
  accountMenu.classList.toggle('hidden');
});

btnSignout?.addEventListener('click', async () => {
  accountMenu.classList.add('hidden');
  await firebase.auth().signOut();
});

function openPremiumModal() {
  premiumStatus.textContent = '';
  premiumModal.classList.remove('hidden');
}
function closePremiumModal() {
  premiumModal.classList.add('hidden');
}
btnPremium?.addEventListener('click', openPremiumModal);
btnOpenPremium?.addEventListener('click', () => { accountMenu.classList.add('hidden'); openPremiumModal(); });
premiumClose?.addEventListener('click', closePremiumModal);
premiumModal?.addEventListener('click', (e) => { if (e.target === premiumModal) closePremiumModal(); });

document.querySelectorAll('.plan-btn').forEach((btn) => {
  btn.addEventListener('click', () => startCheckout(btn.dataset.plan));
});

async function startCheckout(plan) {
  if (!firebaseReady) {
    premiumStatus.textContent = 'Sign-in is not configured yet — see SETUP.md.';
    return;
  }
  if (!currentUser) {
    premiumStatus.textContent = 'Please sign in with Google first.';
    return;
  }
  premiumStatus.textContent = 'Starting checkout…';
  try {
    const createOrder = firebase.functions().httpsCallable('createRazorpayOrder');
    const { data } = await createOrder({ plan });

    const rzp = new Razorpay({
      key: data.keyId,
      order_id: data.orderId,
      amount: data.amount,
      currency: data.currency,
      name: 'TuneGlobe',
      description: PLAN_LABELS[plan] || plan,
      prefill: { email: currentUser.email, name: currentUser.displayName || '' },
      theme: { color: '#ff2e6d' },
      handler: async (response) => {
        premiumStatus.textContent = 'Verifying payment…';
        try {
          const verify = firebase.functions().httpsCallable('verifyRazorpayPayment');
          await verify({
            plan,
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
          premiumStatus.textContent = 'You are Premium! 🎉';
          setTimeout(closePremiumModal, 1500);
        } catch (err) {
          console.error('Verification failed', err);
          premiumStatus.textContent = 'Payment received but verification failed — contact support.';
        }
      },
      modal: {
        ondismiss: () => { premiumStatus.textContent = ''; },
      },
    });
    rzp.open();
  } catch (err) {
    console.error('Checkout failed', err);
    premiumStatus.textContent = 'Could not start checkout. Please try again.';
  }
}

window.TuneGlobe = window.TuneGlobe || {};
window.TuneGlobe.Auth = {
  getCurrentUser: () => currentUser,
  isPremium,
  openPremiumModal,
};

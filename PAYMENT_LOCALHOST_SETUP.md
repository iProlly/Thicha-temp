# Thicha localhost payment setup

This version removes Omise completely.

## Payment methods

- **Card** → Stripe Checkout
- **QR Payment** → Stripe Checkout using PromptPay
- **PayPal** → standalone PayPal Checkout

## Files changed/needed

- `server.js`
- `payment.html`
- `payment.css`
- `join-course.html`
- `package.json`
- `.env.example`
- `PAYMENT_LOCALHOST_SETUP.md`

## Required keys

### Stripe

Use test mode keys:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### PayPal

Create a PayPal Developer app in Sandbox mode and add:

```env
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

The frontend only loads the PayPal Client ID.
The backend uses the PayPal Secret to create and capture orders.

## How to run

```bash
npm install
npm start
```

Open frontend with Live Server:

```txt
http://127.0.0.1:5500/profile.html
```

Test backend:

```txt
http://localhost:4242/api/health
```

## Flow

```txt
profile.html
→ Join Course
→ join-course.html
→ Buy Now
→ payment.html
→ Card / QR Payment / PayPal
→ backend verifies payment status
→ courseId is added to enrolledCourses in Firestore from frontend
→ redirects to profile.html
```

## Test details

### Stripe card

```txt
4242 4242 4242 4242
Any future date
Any CVC
```

### Stripe QR Payment

Use Stripe test mode and follow Checkout instructions.

### PayPal

Use a PayPal sandbox buyer account to approve the test purchase.

## Production note

Before production, move `enrolledCourses` updates to the backend or webhooks and verify Firebase ID tokens with Firebase Admin.

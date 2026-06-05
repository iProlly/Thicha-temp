# Thicha localhost payment setup

This version supports:

- **Card** through Stripe Checkout
- **PayPal** through Stripe Checkout, if PayPal is enabled/available in your Stripe test account
- **PromptPay** through Omise Test Mode

## Files changed/needed

- `payment.html`
- `payment.css`
- `server.js`
- `package.json`
- `.env`
- `.env.example`
- `OMISE_LOCALHOST_SETUP.md`

## Keys included

The uploaded version includes your test keys:

- Omise public/secret test keys
- Stripe publishable/secret test keys

This is for localhost test mode only. Do not deploy test keys to production.

## How to run

1. Put these files in your project folder.
2. Start your backend:

```bash
npm start
```

It should say:

```txt
Thicha localhost payment backend running at http://localhost:4242
```

3. Open your frontend with Live Server:

```txt
http://127.0.0.1:5500/profile.html
```

## Flow

```txt
profile.html
→ Join Course
→ join-course.html
→ Buy Now
→ payment.html
→ Card / PromptPay / PayPal
→ payment success
→ courseId is added to enrolledCourses in Firestore from the frontend
→ redirects to profile.html
```

## Stripe card test

Use:

```txt
4242 4242 4242 4242
Any future date
Any CVC
```

## PromptPay test

Create the QR, then simulate/complete the charge in the Omise dashboard. After that, click **Check Payment Status**.

## PayPal test

PayPal appears through Stripe Checkout only if PayPal is enabled and available for your Stripe test account. If Stripe returns an error, enable PayPal in Stripe payment methods or test Card first.

## Production note

Before production, move enrollment to the backend/webhook and verify Firebase ID tokens with Firebase Admin. The current frontend enrollment is only for localhost testing.

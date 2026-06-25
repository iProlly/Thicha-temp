require("dotenv").config();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 4242;

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY in .env");
}

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const FRONTEND_BASE = process.env.FRONTEND_BASE || "http://127.0.0.1:5500";

const PAYPAL_MODE = process.env.PAYPAL_MODE || "sandbox";
const PAYPAL_API_BASE = PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:4242",
    "http://127.0.0.1:4242"
  ]
}));

app.use(express.json());

const courses = {
  "beginner-thai-course": {
    title: "Complete Beginner Thai Course",
    thbAmount: 139000,      // Stripe Card / QR Payment in satang = ฿1,390
    usdAmount: "39.00",     // PayPal in USD
    thbDisplay: "฿1,390",
    usdDisplay: "$39.00"
  },
  "thai-speaking-practice": {
    title: "Thai Speaking Practice Course",
    thbAmount: 89000,       // Stripe Card / QR Payment in satang = ฿890
    usdAmount: "25.00",     // PayPal in USD
    thbDisplay: "฿890",
    usdDisplay: "$25.00"
  }
};

const ebooks = {
  "beginner-thai-ebook": {
    title: "Beginner Thai Ebook",
    thbAmount: 49000,       // Stripe Card / QR Payment in satang = ฿490
    usdAmount: "15.00",
    thbDisplay: "฿490",
    usdDisplay: "$15.00"
  }
};

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (error) {
    return {};
  }
}

function requireLoginToken(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: "Missing Firebase login token." });
  }

  // Localhost test mode only.
  // Production should verify this token with Firebase Admin and enroll users from the backend/webhook.
  req.firebaseIdToken = token;
  req.firebaseUser = decodeJwtPayload(token);
  next();
}

function getCourseOrFail(courseId) {
  return courses[courseId] || null;
}

function getItemOrFail(itemId, itemType = "course") {
  if (itemType === "ebook") return ebooks[itemId] || null;
  return courses[itemId] || null;
}

function itemUrlParam(itemId, itemType = "course") {
  return `${itemType === "ebook" ? "ebook" : "course"}=${encodeURIComponent(itemId)}`;
}

function stripeAuthHeader() {
  return "Basic " + Buffer.from(`${process.env.STRIPE_SECRET_KEY}:`).toString("base64");
}

function encodeStripeForm(data) {
  const form = new URLSearchParams();

  function appendValue(key, value) {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((item, index) => appendValue(`${key}[${index}]`, item));
      return;
    }

    if (typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => {
        appendValue(`${key}[${childKey}]`, childValue);
      });
      return;
    }

    form.append(key, String(value));
  }

  Object.entries(data).forEach(([key, value]) => appendValue(key, value));
  return form;
}

async function stripeRequest(path, body = null) {
  const options = {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: stripeAuthHeader()
    }
  };

  if (body) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = encodeStripeForm(body);
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Stripe request failed.");
  }

  return data;
}

function requirePayPalConfig() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env");
  }
}

async function getPayPalAccessToken() {
  requirePayPalConfig();

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error_description || data?.message || "Could not get PayPal access token.");
  }

  return data.access_token;
}

async function paypalRequest(path, body = null) {
  const accessToken = await getPayPalAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || data?.details?.[0]?.description || "PayPal request failed.");
  }

  return data;
}

function requireGmailConfig() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env");
  }
}

function createMailTransporter() {
  requireGmailConfig();

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "Thicha localhost payment backend is running.",
    payments: {
      stripeCard: true,
      stripeQrPayment: true,
      paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
      wiseNotifyConfigured: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    }
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
    paypalMode: PAYPAL_MODE
  });
});

app.post("/api/create-stripe-checkout-session", requireLoginToken, async (req, res) => {
  try {
    const { courseId, ebookId, itemId: rawItemId, itemType: rawItemType, method } = req.body;
    const itemType = rawItemType === "ebook" || ebookId ? "ebook" : "course";
    const itemId = rawItemId || ebookId || courseId;
    const item = getItemOrFail(itemId, itemType);

    if (!item) {
      return res.status(400).json({ error: `Invalid ${itemType}.` });
    }

    const paymentMethod = method === "promptpay" ? "promptpay" : "card";

    const session = await stripeRequest("/checkout/sessions", {
      mode: "payment",
      success_url: `${FRONTEND_BASE}/payment.html?${itemUrlParam(itemId, itemType)}&stripe_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_BASE}/payment.html?${itemUrlParam(itemId, itemType)}&stripe_cancelled=1`,
      client_reference_id: itemId,
      payment_method_types: [paymentMethod],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "thb",
            unit_amount: item.thbAmount,
            product_data: {
              name: item.title
            }
          }
        }
      ],
      metadata: {
        itemId,
        itemType,
        courseId: itemType === "course" ? itemId : "",
        ebookId: itemType === "ebook" ? itemId : "",
        localTest: "true",
        method: paymentMethod
      },
      payment_intent_data: {
        metadata: {
          itemId,
          itemType,
          courseId: itemType === "course" ? itemId : "",
          ebookId: itemType === "ebook" ? itemId : "",
          localTest: "true",
          method: paymentMethod
        }
      }
    });

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
      itemId,
      itemType,
      courseId: itemType === "course" ? itemId : "",
      ebookId: itemType === "ebook" ? itemId : ""
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Could not create Stripe Checkout session."
    });
  }
});

app.get("/api/check-stripe-session/:sessionId", requireLoginToken, async (req, res) => {
  try {
    const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(req.params.sessionId)}`);
    const paid = session.payment_status === "paid" || session.status === "complete";
    const itemId = session.metadata?.itemId || session.metadata?.courseId || session.metadata?.ebookId || session.client_reference_id;
    const itemType = session.metadata?.itemType || (session.metadata?.ebookId ? "ebook" : "course");

    res.json({
      sessionId: session.id,
      paid,
      status: session.status,
      paymentStatus: session.payment_status,
      itemId,
      itemType,
      courseId: itemType === "course" ? itemId : "",
      ebookId: itemType === "ebook" ? itemId : ""
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Could not check Stripe session."
    });
  }
});

app.post("/api/create-paypal-order", requireLoginToken, async (req, res) => {
  try {
    const { courseId, ebookId, itemId: rawItemId, itemType: rawItemType } = req.body;
    const itemType = rawItemType === "ebook" || ebookId ? "ebook" : "course";
    const itemId = rawItemId || ebookId || courseId;
    const item = getItemOrFail(itemId, itemType);

    if (!item) {
      return res.status(400).json({ error: `Invalid ${itemType}.` });
    }

    const order = await paypalRequest("/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: `${itemType}:${itemId}`,
          description: item.title,
          amount: {
            currency_code: "USD",
            value: item.usdAmount
          }
        }
      ],
      application_context: {
        brand_name: "Thicha",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING"
      }
    });

    res.json({
      orderId: order.id,
      itemId,
      itemType,
      courseId: itemType === "course" ? itemId : "",
      ebookId: itemType === "ebook" ? itemId : ""
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Could not create PayPal order."
    });
  }
});

app.post("/api/capture-paypal-order", requireLoginToken, async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Missing PayPal order ID." });
    }

    const capture = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});

    const purchaseUnit = capture.purchase_units?.[0];
    const customId = purchaseUnit?.custom_id || "";
    const [customType, customItemId] = customId.includes(":") ? customId.split(":") : ["course", customId];
    const itemType = customType === "ebook" ? "ebook" : "course";
    const itemId = customItemId;
    const captureData = purchaseUnit?.payments?.captures?.[0];
    const paid = capture.status === "COMPLETED" || captureData?.status === "COMPLETED";

    res.json({
      orderId: capture.id,
      paid,
      status: capture.status,
      captureStatus: captureData?.status || "",
      itemId,
      itemType,
      courseId: itemType === "course" ? itemId : "",
      ebookId: itemType === "ebook" ? itemId : ""
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Could not capture PayPal order."
    });
  }
});

app.post("/api/notify-wise-payment", requireLoginToken, async (req, res) => {
  try {
    const {itemId, itemType: rawItemType, price} = req.body;
    const itemType = rawItemType === "ebook" ? "ebook" : "course";
    const item = getItemOrFail(itemId, itemType);


    if (!itemId || !item) {
      return res.status(400).json({ error: `Invalid ${itemType}.` });
    }

    const studentUid = req.firebaseUser.user_id || req.firebaseUser.uid || req.firebaseUser.sub || "Unknown UID";
    const studentEmail = req.firebaseUser.email || "Unknown email";
    const notifiedAt = new Date().toISOString();
    const notifyEmail = process.env.WISE_NOTIFY_EMAIL || "peterisland.candy@gmail.com";

    const transporter = createMailTransporter();
    await transporter.sendMail({
      from: `Thicha Wise Notification <${process.env.GMAIL_USER}>`,
      to: notifyEmail,
      subject: `Wise payment notification: ${itemType} ${itemId}`,
      text: [
        "A student clicked Notify Payment for a Wise transfer.",
        "",
        `Student Firebase UID: ${studentUid}`,
        `Student email: ${studentEmail}`,
        `Item ID: ${itemId}`,
        `Item Type: ${itemType}`,
        `Expected Price: ${price || item.thbDisplay}`,
        `Date/time: ${notifiedAt}`,
        "",
        "Please manually verify the Wise transfer before enrolling the student. Do NOT enroll until the transfer is confirmed."
      ].join("\n")
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Could not send Wise payment notification."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Thicha localhost payment backend running at http://localhost:${PORT}`);
  console.log(`Open your frontend with Live Server at ${FRONTEND_BASE}/profile.html`);
});

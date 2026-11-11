/* =====================================================================
   STRIPE DONATION LINKS: the only file you need to edit.

   Paste each Stripe Payment Link between the quotes. They look like:
       https://buy.stripe.com/abc123XYZ
   Payment Links are public URLs and safe to put here.
   NEVER paste a Stripe secret key (sk_live_... or rk_live_...) anywhere in this website.

   - Leave a url empty ("") and that amount is simply not shown.
   - While every url is empty, the Donate page keeps its original
     "Donate securely" button, so nothing breaks before Stripe is ready.
   ===================================================================== */
window.ZAKALIYA_DONATE = {
  currency: "$",

  // One-time gifts with a fixed amount (each needs its own Payment Link)
  once: [
    { amount: 25,  url: "" },
    { amount: 50,  url: "" },
    { amount: 100, url: "" },
    { amount: 250, url: "" }
  ],

  // One-time gift where the donor types any amount on Stripe's page
  // (Payment Link created with "Customers choose what to pay")
  onceOther: "",

  // Monthly gifts (each needs its own recurring Payment Link)
  monthly: [
    { amount: 25,  url: "" },
    { amount: 50,  url: "" },
    { amount: 100, url: "" }
  ]
};

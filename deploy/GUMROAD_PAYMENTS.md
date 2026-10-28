# ALKUNT Gumroad payments

This integration is separate from connecting a bank account to Gumroad. It uses a scoped OAuth token (`edit_products view_sales`) and never needs payout, refund, account-wide or tax-data permissions. Card entry and payment confirmation take place on Gumroad.

## Configuration and activation

Set these variables only on the existing ALKUNT production service:

- `GUMROAD_ACCESS_TOKEN`: secret, scoped OAuth access token.
- `GUMROAD_SELLER_ID`: the expected seller identifier.
- `GUMROAD_STORE_ORIGIN`: `https://alkuntia.gumroad.com`.
- `GUMROAD_WEBHOOK_SECRET`: a separate random secret of at least 32 characters.
- `GUMROAD_ENABLED=true` and `GUMROAD_CURRENCY_ACCEPTED=USD`: both gates are required to accept new automatic checkouts. Do not enable them until the owner approves USD pricing and the integration is verified.

The owner can check the connection from Settings. The panel distinguishes a connected account from active automatic payments. With either activation gate absent, the existing payment-link/manual-transfer checkout remains available. Existing orders and payment instructions are retained.

Register `sale`, `refund`, `dispute`, and `dispute_won` resource subscriptions for this application. The destination is the production origin plus `/api/payments/gumroad/webhook?key=WEBHOOK_SECRET`; substitute the secret securely and do not copy that URL into documentation, screenshots or logs. Register only this application's subscriptions; leave other integrations unchanged.

## Checkout and delivery

The server stores a 15-minute quote bound to the account, original products, prices and coupon. For a paid order it creates a draft digital checkout product describing the selected ALKUNT content, stores the durable order/product binding, then publishes the fixed-price, single-purchase link. No premium files or buyer contact details are placed in its public description. Failed or uncertain product creation is never retried blindly. A known draft can be recovered without another product.

ALKUNT prices remain in their original currency. Checkout uses USD; the exact USD content amount appears above the confirmation button on desktop and mobile. ExchangeRate-API's keyless endpoint supplies the indicative conversion, cached until the next daily update, with a linked attribution. A cached rate older than 48 hours is rejected. The bank's conversion can differ. Gumroad calculates applicable sales taxes at its own checkout, so the legacy manual-transfer tax setting is not added a second time. The current automatic checkout range is USD 1–10,000. A full-discount order grants access without contacting Gumroad or collecting card information.

The buyer must use the same email address as the ALKUNT account. A return URL, browser assertion, posted price or webhook success flag never grants access. The server reads the canonical sale and independently requires that sale to appear in Gumroad's successful-sales collection. The single-sale endpoint alone is insufficient because it can expose failed and test records. Seller, product, buyer email, original USD cents, quantity and creation time must all match. Sale IDs are unique to an order and verification is serialized per sale.

Successful purchases create the existing ALKUNT order/grant records. Full refunds remove only that order's entitlements; another confirmed purchase is preserved. Disputes suspend access and a verified win restores it. Partial refunds are marked for owner review. Refunds are performed in Gumroad by the owner, never by this application. Legacy manual review cannot override a Gumroad order. Existing accounts, passwords, files and unrelated settings are not migrated.

## Verification

- `node tests/gumroad.test.mjs`: isolated SQLite plus intercepted provider/FX calls, including underpayments, wrong account, failed/test sales, duplicate requests, stale quotes, coupon preservation, refund/dispute transitions, origin and webhook validation.
- Normal `npm test` includes this suite; the existing platform, authentication, media and marketing suites remain in place.
- Production build uses the main repository's strict TypeScript configuration. HTTP regression tests use a temporary database with mail and live payments disabled.
- Local UI preview uses mock credentials and a mock rate; it must never be described as a real payment test.

No real payment, refund or campaign is authorized by these tests. A completed integration still requires a verified live checkout and, when appropriate, Gumroad's documented no-charge test-purchase flow. Never pay for the seller's own product as a test.

## Official references reviewed 2026-10-28

- [API, scopes and sales](https://gumroad.com/api)
- [Create an API application](https://gumroad.com/help/article/280-create-application-api)
- [Checkout integration](https://gumroad.com/help/article/44-build-gumroad-into-your-website)
- [Taxes handled by Gumroad](https://gumroad.com/help/article/121-sales-tax-on-gumroad)
- [Customer and test-purchase flow](https://gumroad.com/help/article/282-how-do-purchases-work-for-my-customers)
- [Successful-sales collection](https://github.com/antiwork/gumroad/blob/main/app/controllers/api/v2/sales_controller.rb)
- [Exchange rate API](https://www.exchangerate-api.com/docs/free)

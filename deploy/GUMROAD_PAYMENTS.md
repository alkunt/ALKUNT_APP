# ALKUNT Gumroad payments

This integration is separate from connecting a bank account to Gumroad. It uses a scoped OAuth token (`edit_products view_sales`) and never needs payout, refund, account-wide or tax-data permissions. Card entry and payment confirmation take place on Gumroad.

## Configuration and activation

Set these variables only on the existing ALKUNT production service:

- `GUMROAD_ACCESS_TOKEN`: secret, scoped OAuth access token.
- `GUMROAD_SELLER_ID`: the expected seller identifier.
- `GUMROAD_STORE_ORIGIN`: `https://alkuntia.gumroad.com`.
- `GUMROAD_WEBHOOK_SECRET`: a separate random secret of at least 32 characters.
- `GUMROAD_ENABLED=true` and `GUMROAD_CURRENCY_ACCEPTED=USD`: both gates are required to accept new automatic checkouts. Do not enable them until the owner approves USD pricing and the integration is verified.
- `GUMROAD_DELIVERY_FILES`: private JSON mapping each approved paid ALKUNT product ID to `{ "sourceFileId": "the-current-ALKUNT-content-file-id", "urls": ["canonical-Gumroad-file-URL"] }`. Never commit real delivery URLs or send them to the browser. A missing mapping, missing source attachment, or a changed source file blocks new paid orders before contacting the payment provider. Free orders do not require this mapping.

The owner can check the connection from Settings. The panel distinguishes a connected account from active automatic payments. With either activation gate absent, the existing payment-link/manual-transfer checkout remains available. Existing orders and payment instructions are retained.

Register `sale`, `refund`, `dispute`, and `dispute_won` resource subscriptions for this application. The destination is the production origin plus `/api/payments/gumroad/webhook?key=WEBHOOK_SECRET`; substitute the secret securely and do not copy that URL into documentation, screenshots or logs. Register only this application's subscriptions; leave other integrations unchanged.

## Checkout and delivery

The server stores a 15-minute quote bound to the account, original products, prices and coupon. For a paid order it creates a draft digital checkout product with the approved deliverable files, stores the durable order/product binding, then publishes the fixed-price, single-purchase link only after Gumroad confirms the attachments. Buyers receive actual downloads on Gumroad as well as verified ALKUNT library access. No private file URLs or buyer contact details are placed in the public description or returned in quotes/orders. Failed or uncertain product creation is never retried blindly. A known draft can be recovered with the order's retry action without creating another product, even after quote expiry; existing attached files are preserved. An unfinished link is shown as needing preparation, rather than ready for payment.

Before copying a protected attachment to Gumroad, obtain the owner's specific approval for that product and destination. Upload the actual file through Gumroad's official Files API (`presign`, multipart upload, then `complete`) or the owner editor. Preserve the original on ALKUNT. Save the canonical URL returned by `complete` securely; product GET returns a temporary signed download URL and is not a substitute. Configure the mapping with the current ALKUNT source file ID. Gumroad `files[][url]` fields attach these canonical URLs to each draft. Do not use placeholder files, an external message instruction, a receipt, or a fake license key as the purchased deliverable. The server repairs an empty known draft only; it never blindly replaces an existing file collection.

Gumroad's live Files API can return path-style canonical URLs such as `https://s3.amazonaws.com/gumroad/attachments/...`, while its documentation also shows virtual-hosted `gumroad-specials.s3.amazonaws.com` URLs. Preserve the exact canonical URL from `complete`. Delivery validation accepts only unsigned HTTPS attachment URLs in the two named Gumroad buckets (`gumroad` and `gumroad-specials`), including their official virtual-hosted forms. Other S3 buckets, credentials, query strings and non-attachment paths are rejected.

Sales must remain paused until at least the published paid products have approved, working delivery files and a live hosted checkout has been verified. Adding an attachment in ALKUNT alone does not approve copying it to a third party. Do not treat a connected API token or a successful webhook sample as proof of a working purchase.

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
- [Official Files API](https://gumroad.com/api#files)
- [Digital-product delivery terms](https://gumroad.com/terms)
- [Create an API application](https://gumroad.com/help/article/280-create-application-api)
- [Checkout integration](https://gumroad.com/help/article/44-build-gumroad-into-your-website)
- [Taxes handled by Gumroad](https://gumroad.com/help/article/121-sales-tax-on-gumroad)
- [Customer and test-purchase flow](https://gumroad.com/help/article/282-how-do-purchases-work-for-my-customers)
- [Successful-sales collection](https://github.com/antiwork/gumroad/blob/main/app/controllers/api/v2/sales_controller.rb)
- [Exchange rate API](https://www.exchangerate-api.com/docs/free)

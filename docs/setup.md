# Set it up

*You won't run any of this yourself if you hire me for it — this page is here so you (or your own dev team) can
see exactly what's involved, and so there's a clean reference when I set it up for your account.*

You need Docker and Node 18+, plus an Anthropic API key. Node is only used for the tests and `build.js`; n8n
itself runs in Docker.

## 1. Run n8n locally

```bash
docker run -d --name n8n -p 5678:5678 -e GENERIC_TIMEZONE=Asia/Kolkata -e TZ=Asia/Kolkata -v n8n_data:/home/node/.n8n -v "$PWD:/files" docker.n8n.io/n8nio/n8n
```

Open <http://localhost:5678> and create your login.

## 2. Google Sheet

Create a Sheet with one tab, **`Invoices`**, row 1 headers in this order:

```text
Received at, Invoice ID, Vendor, Invoice date, Items, Subtotal, Tax, Total, Currency, Status, Flags
```

- Give `Status` a dropdown: `Needs review, Approved`.
- Format `Received at` as plain text (Format → Number → Plain text).

## 3. Credentials in n8n

- **Anthropic API:** add your API key as an HTTP Header Auth credential (header `x-api-key`), used by the
  **Extract with AI** node.
- **Google Sheets OAuth2 and Gmail OAuth2** (one OAuth client covers both; enable the Sheets, Drive and Gmail
  APIs): create an OAuth client in Google Cloud with redirect URI
  `http://localhost:5678/rest/oauth2-credential/callback`, then add the credential in n8n and sign in.
- **Webhook secret:** create a **Header Auth** credential named `Intake webhook secret`, header name
  `X-Intake-Secret`, long random value. Copy `.env.example` to `.env` with the same value.

## 4. Build, import, publish

```bash
SHEET_ID=<sheet id> node build.js
```

```bash
docker exec n8n n8n import:workflow --input=/files/workflow.json && docker exec n8n n8n publish:workflow --id=snapTallyInvoices01 && docker restart n8n
```

Open the workflow and pick your credentials on the webhook node, the Anthropic HTTP node, both Google Sheets
nodes, and the Gmail node. Then publish.

## 5. Try it

Replace the placeholder URL in `payloads/new-invoice.json` with a real public image/PDF URL of a sample invoice,
then:

```bash
./send-test.sh payloads/new-invoice.json
```

A new row should appear in the Invoices sheet, and a review email should arrive. Try an invoice with an
intentionally wrong total to see the math-check flag fire.

To run the rule tests (no image or API key needed, since these feed the logic layer directly):
`node extract.test.js` should print `extract ok`.

## Going live with a real intake source

**This is the one piece that's genuinely per-client**, since "how does an invoice reach this workflow" varies:

- **Email attachment:** an IMAP/Gmail trigger watching a dedicated inbox, saving the attachment and resolving a
  URL for it before calling **Extract with AI**.
- **WhatsApp:** a Business Cloud API webhook on incoming media messages, same idea.
- **A Drive or Dropbox folder:** a "new file" trigger on a dedicated upload folder.

Whichever it is, the only requirement reaching **Extract with AI** is a `source_image_url` it can fetch (public
or signed). Everything downstream of that point is already built and tested.

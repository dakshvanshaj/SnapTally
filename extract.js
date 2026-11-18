// Business rules for invoice/receipt extraction review. Pure functions; the same text is inlined
// into the n8n Code nodes by build.js. The actual vision extraction (Claude or another vision
// model reading the photo/PDF) happens in n8n, before this runs — this only validates and
// formats whatever structured JSON that step returns.
// All times are IST wall-clock, held as "fake UTC" Dates (read with getUTC*), so host timezone never matters.

const IST_MS = 330 * 60000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ist = (d) => new Date(d.getTime() + IST_MS);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (f) => `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())} ${pad(f.getUTCHours())}:${pad(f.getUTCMinutes())}`;

function clean(v) {
  const s = v == null ? '' : String(v).trim();
  return ['', 'nan', 'n/a'].includes(s.toLowerCase()) ? '' : s;
}

function toNumber(v) {
  const s = clean(v).replace(/[,₹$€£]/g, '');
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}

const fmt2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

// The ONLY place that knows the vision-extraction step's output shape. Swap this if the actual
// prompt/model returns different field names — everything below works off this normalized shape.
function fromExtraction(body) {
  const b = body || {};
  const lineItems = Array.isArray(b.line_items) ? b.line_items.map((li) => {
    const qty = toNumber(li.qty) ?? 1;
    const unitPrice = toNumber(li.unit_price);
    return {
      description: clean(li.description),
      qty, unitPrice,
      lineTotal: toNumber(li.line_total) ?? (unitPrice != null ? qty * unitPrice : null),
    };
  }) : [];
  return {
    invoiceId: clean(b.invoice_number) || clean(b.id),
    vendor: clean(b.vendor || b.supplier),
    invoiceDate: clean(b.invoice_date || b.date),
    lineItems,
    subtotal: toNumber(b.subtotal),
    tax: toNumber(b.tax),
    total: toNumber(b.total),
    currency: clean(b.currency) || '$',
    sourceUrl: clean(b.source_image_url || b.source_url),
  };
}

const REQUIRED = [['vendor', 'vendor name'], ['total', 'total amount']];

// Checks the AI's own arithmetic, not just whether fields are present — this is the trust
// layer: an invoice that "reads fine" but doesn't add up gets flagged instead of blindly filed.
function checkMath(doc) {
  const flags = [];
  const lineSum = doc.lineItems.reduce((s, li) => s + (li.lineTotal || 0), 0);
  if (doc.lineItems.length && doc.subtotal != null && Math.abs(lineSum - doc.subtotal) > 0.02) {
    flags.push(`Line items sum to ${doc.currency}${fmt2(lineSum)} but subtotal says ${doc.currency}${fmt2(doc.subtotal)}`);
  }
  if (doc.subtotal != null && doc.tax != null && doc.total != null && Math.abs(doc.subtotal + doc.tax - doc.total) > 0.02) {
    flags.push(`Subtotal + tax (${doc.currency}${fmt2(doc.subtotal + doc.tax)}) doesn't match the total (${doc.currency}${fmt2(doc.total)})`);
  }
  return flags;
}

const FINANCIAL_FIELDS = ['Vendor', 'Subtotal', 'Tax', 'Total', 'Currency'];

// existing = the Invoices sheet row already holding this invoice, or null. An update keeps Status
// ONLY if the reviewed figures haven't changed — approval never carries across a change to the
// actual numbers, so a corrected resend (or a different re-scan of the same invoice) goes back to
// review instead of silently staying Approved.
function buildReview(doc, receivedAt, existing) {
  const flags = [];
  const missing = REQUIRED.filter(([k]) => !doc[k]).map(([, label]) => label);
  if (missing.length) flags.push('Missing: ' + missing.join(', '));
  if (!doc.lineItems.length) flags.push('No line items extracted – check the image quality');
  flags.push(...checkMath(doc));
  const row = {
    'Received at': (existing && existing['Received at']) || fmt(ist(receivedAt)), 'Invoice ID': doc.invoiceId || `no-id-${receivedAt.getTime()}`,
    Vendor: doc.vendor, 'Invoice date': doc.invoiceDate, Items: doc.lineItems.length,
    Subtotal: doc.subtotal == null ? '' : doc.subtotal, Tax: doc.tax == null ? '' : doc.tax, Total: doc.total == null ? '' : doc.total,
    Currency: doc.currency, Status: '', Flags: '',
  };
  const changed = existing && FINANCIAL_FIELDS.some((k) => String(existing[k] ?? '') !== String(row[k] ?? ''));
  if (changed) flags.push('Figures changed since the last review – approval reset');
  row.Status = (existing && !changed && existing.Status) || 'Needs review';
  row.Flags = flags.join('; ');
  const subject = `${row.Flags ? '⚠ ' : ''}Invoice to review: ${doc.vendor || '?'} – ${doc.currency}${doc.total == null ? '?' : fmt2(doc.total)}`;
  return { row, subject, updated: !!existing };
}

// ---- HTML email (inline styles only: email clients drop <style> blocks) ----
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const FONT = "font-family:Arial,Helvetica,sans-serif;color:#1f2937;";
function shell(title, colour, body, sheetUrl, footer) {
  return `<div style="${FONT}max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">`
    + `<div style="background:${colour};color:#fff;padding:14px 18px;font-size:18px;font-weight:bold">${title}</div>`
    + `<div style="padding:16px 18px">${body}`
    + `<p style="margin:18px 0 4px"><a href="${esc(sheetUrl)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:9px 14px;border-radius:6px;font-size:14px;display:inline-block">Open Invoices sheet</a></p>`
    + `</div><div style="padding:10px 18px;background:#f9fafb;color:#6b7280;font-size:12px">${footer}</div></div>`;
}
const tr = (k, v, strong) => `<tr><td style="padding:6px 10px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top">${k}</td>`
  + `<td style="padding:6px 0;font-size:14px;${strong ? 'font-weight:bold;' : ''}">${v || '<span style="color:#b91c1c">not set</span>'}</td></tr>`;

function reviewHtml(resp, doc, sheetUrl) {
  const r = resp.row;
  const banner = r.Flags
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;color:#92400e;padding:10px 12px;margin-bottom:14px;font-size:14px">⚠ ${esc(r.Flags)}</div>` : '';
  const body = banner + `<table style="border-collapse:collapse;width:100%">`
    + tr('Vendor', esc(r.Vendor), true) + tr('Invoice date', esc(r['Invoice date'])) + tr('Line items', esc(r.Items))
    + tr('Subtotal', r.Subtotal === '' ? '' : esc(`${r.Currency}${fmt2(r.Subtotal)}`))
    + tr('Tax', r.Tax === '' ? '' : esc(`${r.Currency}${fmt2(r.Tax)}`))
    + tr('Total', r.Total === '' ? '' : esc(`${r.Currency}${fmt2(r.Total)}`), true)
    + (doc.sourceUrl ? `<tr><td colspan="2" style="padding:10px 0 0"><a href="${esc(doc.sourceUrl)}" style="font-size:13px">View the original image/PDF →</a></td></tr>` : '')
    + `</table>`;
  const title = `${resp.updated ? 'Updated: ' : ''}Invoice to review${r.Vendor ? ` – ${esc(r.Vendor)}` : ''}`;
  return shell(title, r.Flags ? '#b45309' : '#0f766e', body, sheetUrl, 'Nothing is pushed to your accounting tool until you mark this Approved in the Invoices sheet.');
}

if (typeof module !== 'undefined') module.exports = { fromExtraction, checkMath, buildReview, reviewHtml };

// Run: node extract.test.js
const assert = require('node:assert/strict');
const { fromExtraction, checkMath, buildReview, reviewHtml } = require('./extract.js');

const base = {
  id: 'inv-1', vendor: 'Acme Supplies', invoice_number: 'INV-1001', invoice_date: '2026-11-10',
  line_items: [{ description: 'Widget A', qty: 2, unit_price: 50 }, { description: 'Widget B', qty: 1, unit_price: 100 }],
  subtotal: 200, tax: 20, total: 220, currency: '$',
};

// fromExtraction normalisation
const D = fromExtraction(base);
assert.equal(D.invoiceId, 'INV-1001'); // invoice_number takes precedence over id
assert.equal(D.vendor, 'Acme Supplies');
assert.equal(D.lineItems.length, 2);
assert.equal(D.lineItems[0].lineTotal, 100); // qty * unit_price when line_total is absent
assert.equal(fromExtraction({ ...base, line_items: [{ description: 'X', unit_price: 10 }] }).lineItems[0].qty, 1); // qty defaults to 1
assert.equal(fromExtraction({ id: 'inv-2' }).invoiceId, 'inv-2'); // falls back to id with no invoice_number

// checkMath: isolated cases
assert.equal(checkMath({ lineItems: [{ lineTotal: 100 }, { lineTotal: 100 }], subtotal: 200, tax: 20, total: 220, currency: '$' }).length, 0);
const lineMismatch = checkMath({ lineItems: [{ lineTotal: 100 }, { lineTotal: 100 }], subtotal: 250, tax: 20, total: 270, currency: '$' });
assert.equal(lineMismatch.length, 1);
assert.match(lineMismatch[0], /Line items sum to \$200\.00 but subtotal says \$250\.00/);
const totalMismatch = checkMath({ lineItems: [{ lineTotal: 100 }, { lineTotal: 100 }], subtotal: 200, tax: 20, total: 300, currency: '$' });
assert.equal(totalMismatch.length, 1);
assert.match(totalMismatch[0], /Subtotal \+ tax \(\$220\.00\) doesn't match the total \(\$300\.00\)/);

// buildReview ok case
const now = new Date('2026-11-10T10:00:00+05:30');
const ok = buildReview(D, now, null);
assert.equal(ok.row.Flags, '');
assert.equal(ok.row.Vendor, 'Acme Supplies');
assert.equal(ok.row.Status, 'Needs review');
assert.equal(ok.subject, 'Invoice to review: Acme Supplies – $220.00');
assert.deepEqual(Object.keys(ok.row), ['Received at', 'Invoice ID', 'Vendor', 'Invoice date', 'Items', 'Subtotal', 'Tax', 'Total', 'Currency', 'Status', 'Flags']);

// missing fields
const missing = buildReview(fromExtraction({ ...base, vendor: '', total: null }), now, null);
assert.match(missing.row.Flags, /Missing: vendor name, total amount/);
assert.match(missing.subject, /^⚠ Invoice to review/);

// no line items extracted
const noItems = buildReview(fromExtraction({ ...base, line_items: [] }), now, null);
assert.match(noItems.row.Flags, /No line items extracted/);

// math mismatch flows through buildReview too
const badMath = buildReview(fromExtraction({ ...base, subtotal: 999 }), now, null);
assert.match(badMath.row.Flags, /Line items sum to \$200\.00 but subtotal says \$999\.00/);

// update keeps Status and first-arrival time
const prev = { 'Received at': '2026-11-01 09:00', 'Invoice ID': 'INV-1001', Status: 'Approved' };
const up = buildReview(D, now, prev);
assert.equal(up.row.Status, 'Approved');
assert.equal(up.row['Received at'], '2026-11-01 09:00');
assert.equal(up.updated, true);

// HTML + XSS escaping + source link
const docWithSource = fromExtraction({ ...base, source_image_url: 'https://files.example.com/inv1.jpg' });
const h1 = reviewHtml(buildReview(docWithSource, now, null), docWithSource, 'https://sheet');
assert.match(h1, /Acme Supplies/); assert.match(h1, /View the original image/);
assert.match(h1, /href="https:\/\/files\.example\.com\/inv1\.jpg"/);
const evilDoc = fromExtraction({ ...base, vendor: '<script>x</script>' });
const h2 = reviewHtml(buildReview(evilDoc, now, null), evilDoc, 'https://sheet');
assert.doesNotMatch(h2, /<script>/); assert.match(h2, /&lt;script&gt;/);
assert.doesNotMatch(reviewHtml(buildReview(D, now, null), D, 'https://sheet'), /View the original image/); // no source link when none given

console.log('extract ok');

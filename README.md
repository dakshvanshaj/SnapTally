# SnapTally (n8n)

[![Tests](https://github.com/dakshvanshaj/SnapTally/actions/workflows/test.yml/badge.svg)](https://github.com/dakshvanshaj/SnapTally/actions/workflows/test.yml)

Never type another invoice by hand. AI invoice/receipt extraction with a human-review step before anything
reaches your accounting tool.

**Docs:** https://dakshvanshaj.com/SnapTally/

- [What it does and why](docs/index.md)
- [How it works](docs/how-it-works.md): the flow, the math check, flags
- [Set it up](docs/setup.md): run locally, credentials, test payloads, going live

Quick check of the rules: `node extract.test.js` should print `extract ok`.
Rebuild `workflow.json` after editing `extract.js`: `SHEET_ID=<id> node build.js`.

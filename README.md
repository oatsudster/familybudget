# สมุดเงินครอบครัว

Static Thai family ledger hosted on GitHub Pages, backed by Cloud Firestore. Open the existing `?h=<householdId>` link on each device to use the same ledger. Existing transaction IDs, category IDs and data remain compatible.

## Access model

There is deliberately **no login, Firebase Authentication, or membership check**. The random household ID in the link is the shared access capability. Anyone with it can read, add, edit, and delete that household's transactions and Amway catalog. The app does not offer a list of households; root household queries and writes are denied. Validation rules constrain record shape, but are not user authentication. Keep a link private if its contents should stay private.

## Local verification

```sh
npm ci
npm test
npm run preview
```

The preview URL printed by the server uses an in-memory Firebase substitute with fictional data. It removes the production Firebase SDK scripts and never connects to the real database. Reloading resets the sample records. Add `&text=200` to the preview URL to test text enlarged to 200%. This test-only option is not part of the deployed app.

Tests cover no-auth startup, monthly totals, duplicate submission, failed-write retry with a stable document ID, validation, backdating, stable category positions, Amway calculations, offline/snapshot status, deterministic running balances, deletion confirmation, invalid links, and escaping notes.

## Deployment

1. Validate and publish the matching database rules before deploying the no-auth frontend:

   ```sh
   firebase deploy --only firestore:rules --project family-budget-f47bb --dry-run
   firebase deploy --only firestore:rules --project family-budget-f47bb
   ```

2. Publish the frontend through the repository's existing GitHub Pages deployment (main branch). The app needs `index.html`, `styles.css`, `app.js`, the manifest, and icon files. No frontend build step is required.

The rules update remains compatible with previously open clients using anonymous auth. Do not deploy the no-auth frontend against the former auth-required rules.

## Behavior

- Amounts are total amounts. Quantity only recalculates an amount when the user explicitly selects an Amway catalog item. Editing old records never reprices them from today's catalog.
- Each new transaction reserves one Firestore document ID. Submissions are locked while a write is pending; retries reuse the same ID.
- Sync status comes from both Firestore listeners' cache/pending-write metadata and network state, rather than login status.
- When a write is waiting for the network, keep the page open until it reports completion. IndexedDB persistence is attempted; private browsing and some environments may not support it. This is not an offline-installable app shell and initial loading still needs network access.
- Dialogs use native modal focus management; primary save actions remain outside the scrollable form. Native text zoom is permitted.

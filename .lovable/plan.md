## Where the sequence stands (verified)

**① Homepage fix + republish — done.** `src/routes/index.tsx` renders only the dark hero: GridMind EPC wordmark, "The operating system for renewable EPC", the O&M subline, one "Sign in" → `/login`, three chips. The public header is suppressed on `/`, and the sitewide description in `__root.tsx` no longer says "Energy Performance Certificate". A live render check confirmed zero `<header>` elements and exactly one "Sign in" on the page; 585 unit tests passed; the deploy to https://gridmind-sparkle.lovable.app was scheduled.

**② Invite move to Sandbox — done.** A database check just now shows exactly: 18 invites in GSI, all `revoked`; 18 invites in Sandbox, all `pending`. GSI holds no pending demo invites. All Sandbox invites were created through the `create_invite` RPC, not raw SQL.

**③ Screenshot — the only remaining step.**

## Plan for ③

1. Capture the new homepage at `/` from the running app at desktop width (1280px viewport), in dark mode as it ships.
2. Run it through the product-shot generator to frame it in a macOS-style window with rounded corners, drop shadow, and a mesh-gradient background. Use the `midnight` preset so the backdrop matches the dark industrial-EPC palette rather than fighting it.
3. Save the result to `/mnt/documents/gridmind-homepage.png` and inspect the rendered output before delivering, checking for clipped text, wrong colors, or a blank/misframed capture.
4. Deliver it in chat as a viewable, downloadable image.

No code, database, or configuration changes in this step.

## Note on the warn window

Day 0 of the 14-day warn window is tracked in `docs/launch-checklist.md` with the flip to block around Aug 8. Nothing in this step changes that; say the word if you want the checklist stamped with the actual Day 0 date as a separate task.

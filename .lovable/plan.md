## Current state (verified)

- `src/routes/index.tsx` already contains the new minimal hero exactly as specified: GridMind EPC wordmark, headline "The operating system for renewable EPC", the O&M subline, a single "Sign in" button linking to `/login`, and the three chips. All assessor/landlord/rating/SAP/certificate copy is gone from this file, and its `head()` meta is renewable-EPC wording. This was shipped and published in the previous turn.
- Two leftovers still carry the wrong domain or break the "nothing else" requirement:
  1. `src/routes/__root.tsx` lines 110 and 116 — sitewide `description` and `og:description` still read "Energy Performance Certificate management powered by GridMind." This is what link previews and search results show for the homepage's fallback metadata.
  2. `src/routes/__root.tsx` renders the public `Header` on every non-authenticated path, including `/`. That header shows a second "Sign in" button plus a theme toggle above the hero, so the homepage is not the single-element page requested.

## Changes

**1. Fix sitewide metadata (`src/routes/__root.tsx`)**

Replace both "Energy Performance Certificate management powered by GridMind." strings with renewable-EPC wording, e.g. "Multi-tenant delivery platform for renewable EPC — solar PV, BESS, and substations." Leave title, theme-color, og:type, and twitter:card untouched.

**2. Make `/` header-free**

Extend the header-suppression logic so the public `Header` does not render on the exact path `/`. The homepage then shows only the hero. All other public routes (`/login`, `/docs/api`, etc.) keep the header unchanged, and authenticated paths keep their existing `AppShell` behaviour.

## Not in scope

No other route, component, doc, or database change. No new marketing sections.

## Verify and ship

- Load `/` in the preview and confirm: no top header, exactly one "Sign in" button, dark hero, three chips, no wrong-domain wording anywhere on the page.
- Grep the `src/` tree for "assessor", "landlord", "SAP-style", "Energy Performance Certificate", "rating trend", "certificate management" and confirm zero matches.
- Run lint and the unit suite to confirm nothing regressed, then republish.

## Plan: Verify theme toggle in preview

Drive Playwright headless against `http://localhost:8080/design-system` and capture evidence.

### Steps

1. Launch Chromium (viewport 1280×1800), navigate to `/design-system`.
2. Screenshot initial state; read `<html class>` and `localStorage['gridmind-theme']`.
3. Click the `ThemeToggle` button (aria-label "Switch to dark theme" / "Switch to light theme").
4. Screenshot after click; re-read `<html class>` and localStorage — expect them to have flipped and persisted.
5. Reload the page; screenshot; re-read `<html class>` — expect it to match the value saved before reload (no flash back to system).
6. Report: initial class, class after toggle, class after reload, localStorage value, plus screenshot paths.

No code changes. If any step fails I'll return a diagnosis instead of editing.
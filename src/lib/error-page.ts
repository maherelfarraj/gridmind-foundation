// Branded 500 HTML for SSR failures. No stack traces, env values, or internal
// messages — safe to serve to any client. Inline CSS mirrors design tokens so
// the page renders even when the app CSS bundle failed to load.

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}

export function renderErrorPage(opts: { errorRef?: string } = {}): string {
  const ref = opts.errorRef ? escapeHtml(opts.errorRef) : "";
  const refBlock = ref
    ? `<p class="ref">Reference: <code>${ref}</code></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Something went wrong · GridMind EPC</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      :root {
        --bg: #f1f5f9;
        --card: #ffffff;
        --fg: #0f172a;
        --muted: #475569;
        --border: #e2e8f0;
        --primary: #1e3a5f;
        --primary-fg: #f8fafc;
        --accent: #f1f5f9;
        --code-bg: #f8fafc;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0b1220;
          --card: #111827;
          --fg: #e2e8f0;
          --muted: #94a3b8;
          --border: #1f2937;
          --primary: #3b5f8a;
          --primary-fg: #f8fafc;
          --accent: #1f2937;
          --code-bg: #0b1220;
        }
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        min-height: 100vh;
        background: var(--bg);
        color: var(--fg);
        font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 15px;
        line-height: 1.55;
        display: grid;
        place-items: center;
        padding: 1.5rem;
      }
      .card {
        width: 100%;
        max-width: 30rem;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 2rem 1.75rem;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .brand {
        font-family: "Space Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif;
        font-weight: 700;
        font-size: 0.8125rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
        margin: 0 0 1.25rem;
      }
      h1 {
        font-family: "Space Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif;
        font-size: 1.375rem;
        font-weight: 600;
        margin: 0 0 0.5rem;
        color: var(--fg);
      }
      p { margin: 0 0 1rem; color: var(--muted); }
      p.body { color: var(--fg); }
      .ref {
        font-size: 0.8125rem;
        padding: 0.625rem 0.75rem;
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--muted);
        margin: 0 0 1.5rem;
      }
      .ref code {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
        font-size: 0.8125rem;
        color: var(--fg);
      }
      .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      a.btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        text-decoration: none;
        border: 1px solid transparent;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      a.primary { background: var(--primary); color: var(--primary-fg); }
      a.primary:hover { filter: brightness(1.08); }
      a.secondary { background: transparent; color: var(--fg); border-color: var(--border); }
      a.secondary:hover { background: var(--accent); }
    </style>
  </head>
  <body>
    <main class="card" role="alert">
      <p class="brand">GridMind EPC</p>
      <h1>Something went wrong on our side.</h1>
      <p class="body">We couldn't complete your request. The issue has been logged and our team will investigate.</p>
      ${refBlock}
      <div class="actions">
        <a class="btn primary" href="">Try again</a>
        <a class="btn secondary" href="mailto:support@gridmindepc.com">Contact support</a>
      </div>
    </main>
  </body>
</html>`;
}

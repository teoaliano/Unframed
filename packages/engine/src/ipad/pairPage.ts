export const pairPage = (options: { readonly code: string; readonly message?: string | undefined }): string => {
  const code = /^\d{0,6}$/.test(options.code) ? options.code : "";
  const message = options.message === undefined ? "" : `<p class="problem">${escapeHtml(options.message)}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pair with Unframed</title>
<style>
:root {
  color-scheme: light;
  --background: oklch(99.2% 0 0);
  --foreground: #27272a;
  --card: #ffffff;
  --border: #e4e4e7;
  --input: #d4d4d8;
  --muted-foreground: #71717a;
  --primary: #171717;
  --primary-foreground: #ffffff;
  --error-foreground: #b91c1c;
  --radius: 0.625rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --background: #0a0a0a;
    --foreground: #f5f5f5;
    --card: #111111;
    --border: rgba(255, 255, 255, 0.06);
    --input: rgba(255, 255, 255, 0.12);
    --muted-foreground: #8f8f8f;
    --primary: #fafafa;
    --primary-foreground: #0a0a0a;
    --error-foreground: #fca5a5;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--background);
  color: var(--foreground);
  font: 15px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif;
}
form {
  width: 100%;
  max-width: 360px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 24px;
  text-align: center;
}
h1 { font-size: 20px; margin: 0 0 8px; }
p { color: var(--muted-foreground); margin: 0 0 20px; }
p.problem { color: var(--error-foreground); }
input {
  width: 100%;
  font-size: 32px;
  letter-spacing: 0.3em;
  text-align: center;
  padding: 12px 8px;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--input);
  border-radius: calc(var(--radius) - 2px);
}
button {
  width: 100%;
  margin-top: 16px;
  padding: 12px;
  font-size: 16px;
  font-weight: 500;
  color: var(--primary-foreground);
  background: var(--primary);
  border: 0;
  border-radius: calc(var(--radius) - 2px);
}
</style>
</head>
<body>
<form method="post" action="/api/ipad/pair">
<h1>Pair with Unframed</h1>
${message}
<input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autofocus value="${code}" aria-label="Pairing code">
<button type="submit">Pair</button>
<p style="margin: 20px 0 0">Find the code in Unframed's Settings on your Mac, under iPad.</p>
</form>
</body>
</html>
`;
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

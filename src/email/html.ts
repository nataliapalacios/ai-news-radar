/** Every string that reaches an email goes through these helpers. */

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only plain https links survive; anything else renders as text. */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export function link(label: string, url: string): string {
  const href = safeHref(url);
  return href ? `<a href="${esc(href)}" style="color:#1d4ed8">${esc(label)}</a>` : esc(label);
}

/** Subjects are single-line text: no control characters, bounded length. */
export function subjectLine(s: string): string {
  const clean = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 150 ? `${clean.slice(0, 147)}...` : clean;
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:16px;background:#f6f7f9;color:#111827;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:20px">
${body}
</div></body></html>`;
}

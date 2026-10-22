import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { subjectLine } from "./html.js";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

/**
 * Send through Gmail SMTP. With DRY_RUN=1 or no SMTP credentials, write the email
 * to out/emails instead, so every job can run locally without sending anything.
 */
export async function sendEmail(to: string[], email: Email): Promise<string> {
  const subject = subjectLine(email.subject);
  const { SMTP_USER, SMTP_PASS, DRY_RUN } = process.env;
  // The example config's placeholder address never receives real mail.
  const placeholder = to.some((r) => /@example\.(com|org|net)$/i.test(r));
  if (placeholder) console.warn("recipients still point at example.com: set them in radar.config.yaml");
  // On GitHub Actions a missing secret must fail the run: silence would look like "no news".
  if (process.env.GITHUB_ACTIONS === "true" && DRY_RUN !== "1") {
    const missing = [!SMTP_USER && "SMTP_USER", !SMTP_PASS && "SMTP_PASS"].filter(Boolean);
    if (missing.length) throw new Error(`Missing repository secret(s): ${missing.join(", ")} (Settings → Secrets and variables → Actions)`);
    if (placeholder) throw new Error("recipients in radar.config.yaml still point at example.com");
  }
  if (DRY_RUN === "1" || !SMTP_USER || !SMTP_PASS || placeholder) {
    const dir = join("out", "emails");
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(subject)}`);
    writeFileSync(`${base}.txt`, `Subject: ${subject}\nTo: ${to.join(", ")}\n\n${email.text}`);
    writeFileSync(`${base}.html`, email.html);
    return `dry run: ${base}.html`;
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  try {
    const info = await transport.sendMail({ from: `AI News Radar <${SMTP_USER}>`, to, subject, text: email.text, html: email.html });
    return `sent: ${info.messageId}`;
  } catch (e) {
    if ((e as { code?: string }).code === "EAUTH")
      throw new Error(
        "Gmail rejected the login (EAUTH). SMTP_PASS must be a Gmail App Password (16 letters, no spaces) " +
        "created on the same account as SMTP_USER, not the account password.",
      );
    throw e;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

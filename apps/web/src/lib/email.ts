import { Resend } from "resend";
import type { ReactElement } from "react";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM || "anyterm <noreply@anyterm.dev>";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  react: ReactElement;
}) {
  if (!resend) {
    console.warn(
      `[email] No RESEND_API_KEY — would send "${opts.subject}" to ${opts.to}`,
    );
    return;
  }

  const { data, error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    react: opts.react,
  });

  if (error) {
    console.error(`[email] Failed to send "${opts.subject}" to ${opts.to}:`, error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  console.log(`[email] Sent "${opts.subject}" to ${opts.to} (id: ${data?.id})`);

}

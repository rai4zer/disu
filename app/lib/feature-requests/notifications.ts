import { log } from "@/app/lib/observability/log";

type FeatureNotificationInput = {
  subject: string;
  text: string;
  html?: string;
};

function isResendProvider(): boolean {
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  return provider === "resend";
}

export async function sendFeatureNotification(input: FeatureNotificationInput): Promise<void> {
  const notificationEmail = (process.env.NOTIFICATION_EMAIL ?? "").trim();
  if (!notificationEmail) {
    return;
  }

  const from = (process.env.SYSTEM_FROM_EMAIL ?? "").trim();
  const resendKey = (process.env.RESEND_API_KEY ?? "").trim();

  if (isResendProvider() && from && resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [notificationEmail],
        subject: input.subject,
        text: input.text,
        html: input.html
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`resend notification failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
    }
    return;
  }

  log.info("feature.notification.mock_send", {
    to: notificationEmail,
    subject: input.subject,
    note: "Email provider not fully configured. Notification send simulated."
  });
}

// User-facing messaging for the sample repository.

export type NotificationChannel = "email" | "sms" | "push";

/**
 * NotificationService is responsible for delivering user-facing messages,
 * including the welcome notification sent right after signup.
 */
export class NotificationService {
  sendWelcomeNotification(userId: string, email: string): void {
    // Compose and deliver the welcome email to a newly created user.
    const message = `Welcome! Your account ${email} is ready.`;
    this.deliver("email", userId, message);
  }

  sendPasswordResetNotification(userId: string, email: string): void {
    this.deliver("email", userId, `Reset your password for ${email}.`);
  }

  private deliver(channel: NotificationChannel, userId: string, body: string): void {
    console.log(`[notification:${channel}] -> ${userId}: ${body}`);
  }
}

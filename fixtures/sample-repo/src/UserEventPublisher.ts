// Publishes user lifecycle domain events for the sample repository.

/**
 * Publishes user lifecycle domain events onto a channel.
 * This is the single source of truth for user events.
 */
export class UserEventPublisher {
  constructor(private readonly channel: string = "user-events") {}

  /** Emit the event that signals a new user was created. */
  publishUserCreated(userId: string): void {
    this.emit("UserCreatedEvent", { userId });
  }

  publishUserDeleted(userId: string): void {
    this.emit("UserDeletedEvent", { userId });
  }

  private emit(name: string, payload: Record<string, unknown>): void {
    // In a real system this would push to Kafka / a message bus.
    console.log(`[${this.channel}] ${name} ${JSON.stringify(payload)}`);
  }
}

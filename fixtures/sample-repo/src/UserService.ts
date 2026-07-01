import { UserEventPublisher } from "./UserEventPublisher";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Application service that owns the user aggregate.
 *
 * UserService is the entry point for creating and loading users. When a new
 * user is created it delegates domain-event publishing to UserEventPublisher.
 */
export class UserService {
  private static counter = 0;
  private readonly users = new Map<string, User>();

  constructor(private readonly events: UserEventPublisher) {}

  createUser(email: string, displayName: string): User {
    const user: User = { id: `user_${UserService.counter++}`, email, displayName };
    this.users.set(user.id, user);
    // Notify the rest of the system that a new user now exists.
    this.events.publishUserCreated(user.id);
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }
}

/** An error whose message is safe and helpful to speak to the user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export const GENERIC_ERROR = "Sorry, something went wrong on my side. Please try again in a moment.";

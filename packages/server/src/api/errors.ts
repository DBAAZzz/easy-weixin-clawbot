/**
 * Request payload rejected by a route's own validation.
 *
 * The message is written for the caller and is safe to return verbatim; the
 * central error handler maps this to 400. Anything else reaching the handler is
 * unexpected and is reported without detail.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

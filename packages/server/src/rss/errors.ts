export class RssValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RssValidationError";
  }
}

export class RssNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RssNotFoundError";
  }
}

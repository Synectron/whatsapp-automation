/** Error types with HTTP semantics, used by the central error handler. */

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(message: string, status = 500, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/** Normalises anything thrown into an Error instance. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}

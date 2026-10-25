export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND'
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export interface StockShortage {
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  requested: number;
  available: number;
  /** Quantity to add to the warehouse so the sale fits exactly. */
  shortBy: number;
}

/** A sale needs more than the warehouse holds; `details.shortages` lists every short line so the UI can offer a fix. */
export class InsufficientStockError extends AppError {
  constructor(shortages: StockShortage[]) {
    const [first] = shortages;
    super(
      shortages.length === 1
        ? `Not enough stock of "${first.productName}" in ${first.warehouseName}: ${first.available} available, ${first.requested} needed`
        : `Not enough stock for ${shortages.length} items`,
      409,
      'INSUFFICIENT_STOCK',
      { shortages }
    );
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}

export class PaymentRequiredError extends AppError {
  constructor(message = 'Upgrade your subscription to access this feature') {
    super(message, 402, 'PAYMENT_REQUIRED');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

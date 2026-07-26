/** Zod-powered request validation middleware. */
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

export type RequestPart = 'body' | 'query' | 'params';

/**
 * Validates (and replaces) a request part with the parsed, typed result.
 * Throws {@link ValidationError} with a field-level breakdown on failure.
 */
export function validate(schema: ZodSchema, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[part]);
      if (part === 'query') Object.defineProperty(req, 'query', { value: parsed, writable: true });
      else req[part] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          new ValidationError(
            'Request validation failed.',
            err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          ),
        );
        return;
      }
      next(err);
    }
  };
}

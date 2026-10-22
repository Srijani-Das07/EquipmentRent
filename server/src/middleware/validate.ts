import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

/**
 * Validates and replaces req.body / req.query / req.params with parsed values.
 * Zod errors are turned into a 400 by the central error handler.
 */
export function validate<S extends Schemas>(schemas: S): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body) as z.infer<NonNullable<S['body']>>;
      if (schemas.query) Object.defineProperty(req, 'query', { value: schemas.query.parse(req.query), writable: true });
      if (schemas.params) Object.defineProperty(req, 'params', { value: schemas.params.parse(req.params), writable: true });
      next();
    } catch (err) {
      next(err);
    }
  };
}

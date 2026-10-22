import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 does not catch rejected promises, so async route handlers go through this. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
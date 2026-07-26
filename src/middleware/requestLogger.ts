/** Minimal access log — one line per completed request. */
import type { NextFunction, Request, Response } from 'express';
import { childLogger } from '../utils/logger';

const log = childLogger('http');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    log.http?.('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
    });
  });
  next();
}

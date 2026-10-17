import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  console.error('[Error]', err);
  return c.json({ error: 'Internal server error' }, 500);
}

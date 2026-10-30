import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this resource') => new ApiError(403, 'forbidden', msg);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in to continue');

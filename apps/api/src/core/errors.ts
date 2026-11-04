import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { TransitionError } from '@jappo/domain';

export interface FieldError {
  path: string;
  message: string;
  code?: string;
}

/** Application error rendered as RFC 9457 problem+json. `code` is a stable machine code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: FieldError[],
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (code: string, detail?: string, errors?: FieldError[]) =>
  new AppError(400, code, 'Bad Request', detail, errors);
export const unauthorized = (code = 'UNAUTHENTICATED', detail?: string) => new AppError(401, code, 'Unauthorized', detail);
export const forbidden = (code = 'FORBIDDEN', detail?: string) => new AppError(403, code, 'Forbidden', detail);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', 'Not Found', `${what} not found`);
export const conflict = (code: string, detail?: string, extra?: Record<string, unknown>) =>
  new AppError(409, code, 'Conflict', detail, undefined, extra);
export const unprocessable = (code: string, detail?: string, errors?: FieldError[], extra?: Record<string, unknown>) =>
  new AppError(422, code, 'Unprocessable Content', detail, errors, extra);
export const preconditionFailed = (detail = 'Resource version does not match If-Match') =>
  new AppError(412, 'VERSION_MISMATCH', 'Precondition Failed', detail);
export const preconditionRequired = () =>
  new AppError(428, 'IF_MATCH_REQUIRED', 'Precondition Required', 'This operation requires an If-Match header');
export const tooMany = (code = 'RATE_LIMITED', detail?: string) => new AppError(429, code, 'Too Many Requests', detail);

const PROBLEM_BASE = 'https://docs.jappo.app/problems/';

export function sendProblem(reply: FastifyReply, req: FastifyRequest, e: AppError): FastifyReply {
  return reply
    .status(e.status)
    .type('application/problem+json; charset=utf-8')
    .send({
      type: PROBLEM_BASE + e.code.toLowerCase().replace(/_/g, '-'),
      title: e.title,
      status: e.status,
      detail: e.detail,
      code: e.code,
      errors: e.errors,
      requestId: req.id,
      ...e.extra,
    });
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) return sendProblem(reply, req, err);
  if (err instanceof TransitionError) {
    return sendProblem(reply, req, conflict('INVALID_STATE_TRANSITION', err.message, { state: err.state, action: err.action }));
  }
  if (hasZodFastifySchemaValidationErrors(err)) {
    const errors = err.validation.map((v) => ({
      path: [err.validationContext, ...(v.instancePath ? v.instancePath.split('/').filter(Boolean) : [])].join('.'),
      message: v.message ?? 'Invalid value',
      code: v.keyword,
    }));
    return sendProblem(reply, req, badRequest('VALIDATION_FAILED', 'Request validation failed', errors));
  }
  if (isResponseSerializationError(err)) {
    req.log.error({ err, issues: err.cause?.issues }, 'response serialization failed');
    return sendProblem(reply, req, new AppError(500, 'RESPONSE_SERIALIZATION', 'Internal Server Error'));
  }
  const fe = err as FastifyError;
  if (fe.statusCode === 429) return sendProblem(reply, req, tooMany('RATE_LIMITED', fe.message));
  if (fe.code === 'FST_REQ_FILE_TOO_LARGE') return sendProblem(reply, req, new AppError(413, 'FILE_TOO_LARGE', 'Payload Too Large', fe.message));
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return sendProblem(reply, req, new AppError(fe.statusCode, fe.code ?? 'BAD_REQUEST', 'Bad Request', fe.message));
  }
  // Postgres unique violation → 409
  const pgCode = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  if (pgCode === '23505') return sendProblem(reply, req, conflict('DUPLICATE', 'A resource with the same unique key exists'));
  req.log.error({ err }, 'unhandled error');
  return sendProblem(reply, req, new AppError(500, 'INTERNAL', 'Internal Server Error'));
}

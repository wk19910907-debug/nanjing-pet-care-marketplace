import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_ORDER_TRANSITION',
  'PAYMENT_REQUIRED',
  'PAYMENT_VERIFICATION_FAILED',
  'DISPATCH_UNAVAILABLE',
  'FULFILLMENT_INCOMPLETE',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

import { z } from 'zod';

export const ServiceTypeSchema = z.enum(['CAT_FEEDING', 'DOG_WALKING']);

export const OrderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PENDING_DISPATCH',
  'PENDING_SERVICE',
  'IN_SERVICE',
  'PENDING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
  'DISPUTED',
  'DISPATCH_FAILED',
  'EXPIRED',
]);

export const ActorRoleSchema = z.enum([
  'OWNER',
  'PROVIDER',
  'REVIEWER',
  'DISPATCHER',
  'SUPPORT',
  'ADMIN',
]);

export const CreateOrderInputSchema = z.object({
  serviceType: ServiceTypeSchema,
  petIds: z.array(z.uuid()).min(1).max(5),
  addressId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  notes: z.string().max(500),
});

export const QuoteBreakdownSchema = z.object({
  baseFen: z.int().nonnegative(),
  extraPetFen: z.int().nonnegative(),
  durationFen: z.int().nonnegative(),
  distanceFen: z.int().nonnegative(),
  holidayFen: z.int().nonnegative(),
  totalFen: z.int().nonnegative(),
  currency: z.literal('CNY'),
});

export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type ActorRole = z.infer<typeof ActorRoleSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type QuoteBreakdown = z.infer<typeof QuoteBreakdownSchema>;

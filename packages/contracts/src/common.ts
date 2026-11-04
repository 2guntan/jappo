import { z } from 'zod';

export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();
/** Integer XOF amount. */
export const Xof = z.number().int();
export const Bps = z.number().int().min(0).max(100_000);
export const Pct = z.number().min(0).max(100);

export const ProblemField = z.object({ path: z.string(), message: z.string(), code: z.string().optional() });
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    code: z.string(),
    errors: z.array(ProblemField).optional(),
    requestId: z.string().optional(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.infer<typeof Problem>;

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  sort: z.string().optional(),
  q: z.string().optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

export const IdParam = z.object({ id: Uuid });
export const Ok = z.object({ ok: z.literal(true) });

export const Locale = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof Locale>;

/** Resources expose the actions currently permitted (SPEC §12.1). */
export const AllowedActions = z.array(z.string());

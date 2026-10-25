import { z } from 'zod';
import {
  MAX_EXCHANGE_RATE,
  MAX_ORIGINAL_AMOUNT,
  isPositiveDecimalInRange,
  normalizeAmount,
  normalizeRate,
} from './money';
import { isValidDate, isValidTimestamp } from './time';

export const currencySchema = z.enum(['JPY', 'THB']);
export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const positiveVersionSchema = z.number().int().positive().max(2_147_483_647);
export const versionSchema = z.object({ version: positiveVersionSchema }).strict();

export const amountSchema = z
  .string()
  .max(32)
  .regex(/^\d+(?:\.\d{1,2})?$/, 'Use a decimal amount with at most two decimal places.')
  .refine(
    (value) => isPositiveDecimalInRange(value, MAX_ORIGINAL_AMOUNT),
    'Amount must be greater than zero and at most 999999999.99.',
  );

export const rateSchema = z
  .string()
  .max(32)
  .regex(/^\d+(?:\.\d{1,8})?$/, 'Use a decimal rate with at most eight decimal places.')
  .refine(
    (value) => isPositiveDecimalInRange(value, MAX_EXCHANGE_RATE),
    'Rate must be greater than zero and at most 100.',
  )
  .transform(normalizeRate);

export const dateSchema = z.string().refine(isValidDate, 'Use a valid YYYY-MM-DD calendar date.');
export const timestampSchema = z
  .string()
  .refine(isValidTimestamp, 'Use a valid timestamp with Z or an explicit offset, such as +09:00.')
  .transform((value) => new Date(value).toISOString());

const purchaseFields = {
  name: z.string().trim().min(1, 'Enter a purchase name.').max(160),
  originalAmount: amountSchema,
  originalCurrency: currencySchema,
  purchaserId: uuidSchema,
  description: z.string().max(4_000),
  purchasedAt: timestampSchema,
  exchangeRate: rateSchema,
};

function checkJpyPrecision(
  input: { originalAmount?: string; originalCurrency?: 'JPY' | 'THB' },
  context: z.RefinementCtx,
) {
  if (input.originalCurrency === 'JPY' && input.originalAmount?.includes('.')) {
    context.addIssue({
      code: 'custom',
      path: ['originalAmount'],
      message: 'JPY must be a whole number.',
    });
  }
}

export const createPurchaseSchema = z
  .object({
    id: uuidSchema,
    ...purchaseFields,
    description: purchaseFields.description.default(''),
    purchasedAt: purchaseFields.purchasedAt.optional(),
    exchangeRate: purchaseFields.exchangeRate.optional(),
  })
  .strict()
  .superRefine(checkJpyPrecision)
  .transform((input) => ({
    ...input,
    originalAmount: normalizeAmount(input.originalAmount, input.originalCurrency),
  }));

export const patchPurchaseSchema = z
  .object({
    name: purchaseFields.name.optional(),
    originalAmount: purchaseFields.originalAmount.optional(),
    originalCurrency: purchaseFields.originalCurrency.optional(),
    purchaserId: purchaseFields.purchaserId.optional(),
    description: purchaseFields.description.optional(),
    purchasedAt: purchaseFields.purchasedAt.optional(),
    exchangeRate: purchaseFields.exchangeRate.optional(),
    version: positiveVersionSchema,
  })
  .strict()
  .superRefine((input, context) => {
    checkJpyPrecision(input, context);
    if (input.originalCurrency !== undefined && input.originalAmount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['originalAmount'],
        message: 'Supply an amount when changing currency.',
      });
    }
    if (!Object.keys(input).some((key) => key !== 'version')) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Supply at least one field to change.',
      });
    }
  });

export const settingsPatchSchema = z
  .object({
    defaultThbPerJpy: rateSchema,
    version: positiveVersionSchema,
  })
  .strict();

export const purchaserCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a purchaser name.').max(60),
  })
  .strict();

export const purchaserPatchSchema = z
  .object({
    name: purchaserCreateSchema.shape.name.optional(),
    archived: z.boolean().optional(),
    version: positiveVersionSchema,
  })
  .strict()
  .refine((input) => input.name !== undefined || input.archived !== undefined, {
    message: 'Supply a name or archive state to change.',
  });

const filterFields = {
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  purchaserId: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
};

function checkDateOrder(input: { from?: string; to?: string }, context: z.RefinementCtx) {
  if (input.from && input.to && input.from > input.to) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'End date must be on or after the start date.',
    });
  }
}

const queryInteger = z
  .union([z.string().regex(/^\d+$/, 'Use a whole number.').transform(Number), z.number().int()])
  .pipe(z.number().int().min(1).max(100));

export const purchaseFiltersSchema = z
  .object({
    ...filterFields,
    status: z.enum(['active', 'deleted']).default('active'),
    limit: queryInteger.default(50),
    cursor: z.string().min(1).max(2_048).optional(),
  })
  .strict()
  .superRefine(checkDateOrder);

export const listFiltersSchema = purchaseFiltersSchema;
export const summaryFiltersSchema = z.object(filterFields).strict().superRefine(checkDateOrder);

/** Defaults are deliberately not resolved here: omission is part of retry identity. */
export function canonicalCreationInput(input: z.input<typeof createPurchaseSchema>): string {
  const validated = createPurchaseSchema.parse(input);
  return JSON.stringify({
    id: validated.id,
    name: validated.name,
    originalAmount: validated.originalAmount,
    originalCurrency: validated.originalCurrency,
    purchaserId: validated.purchaserId,
    description: validated.description,
    ...(validated.purchasedAt !== undefined ? { purchasedAt: validated.purchasedAt } : {}),
    ...(validated.exchangeRate !== undefined ? { exchangeRate: validated.exchangeRate } : {}),
  });
}

export async function hashCreationInput(
  input: z.input<typeof createPurchaseSchema>,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCreationInput(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const hashCreateRequest = hashCreationInput;

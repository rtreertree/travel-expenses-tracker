import { z } from 'zod';
import {
  MAX_EXCHANGE_RATE,
  MAX_ORIGINAL_AMOUNT,
  isPositiveDecimalInRange,
  normalizeAmount,
  normalizeRate,
} from './money';
import { isValidDate, isValidTimestamp } from './time';
import { parseLocation } from './location';

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

export const locationSchema = z.unknown().transform((input, context) => {
  try {
    return parseLocation(input);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Enter a valid location.',
    });
    return z.NEVER;
  }
});

const locationFields = {
  location: locationSchema.optional(),
  gps: locationSchema.optional(),
  latitude: z.union([z.number(), z.string()]).optional(),
  longitude: z.union([z.number(), z.string()]).optional(),
  lat: z.union([z.number(), z.string()]).optional(),
  lng: z.union([z.number(), z.string()]).optional(),
  lon: z.union([z.number(), z.string()]).optional(),
};

function normalizeLocationFields<
  T extends {
    location?: ReturnType<typeof parseLocation>;
    gps?: ReturnType<typeof parseLocation>;
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
    lon?: number | string;
  },
>(input: T, context: z.RefinementCtx) {
  const { gps, latitude, longitude, lat, lng, lon, ...rest } = input;
  const hasCoordinates = [latitude, longitude, lat, lng, lon].some((value) => value !== undefined);
  try {
    const sources = [input.location, gps];
    if (hasCoordinates) sources.push(parseLocation({ latitude, longitude, lat, lng, lon }));
    const provided = sources.filter((value) => value !== undefined);
    if (!provided.length) return rest;
    const locations = provided.filter((value) => value !== null);
    if (locations.length !== provided.length && locations.length) {
      throw new Error(
        'Clearing a location cannot be combined with another location or coordinates.',
      );
    }
    if (!locations.length) return { ...rest, location: null };
    const coordinates = locations.filter((value) => value.latitude !== null);
    const first = coordinates[0];
    if (
      first &&
      coordinates.some(
        (value) => value.latitude !== first.latitude || value.longitude !== first.longitude,
      )
    ) {
      throw new Error('The supplied coordinate sources disagree.');
    }
    const labels = [
      ...new Set(locations.map((value) => value.text).filter((value) => value !== null)),
    ];
    if (labels.length > 1) throw new Error('The supplied location labels disagree.');
    if (first)
      return {
        ...rest,
        location: parseLocation({
          text: labels[0] ?? null,
          latitude: first.latitude,
          longitude: first.longitude,
        }),
      };
    return { ...rest, location: locations[0] };
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['location'],
      message: error instanceof Error ? error.message : 'Enter valid coordinates.',
    });
    return z.NEVER;
  }
}

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
    ...purchaseFields,
    ...locationFields,
    id: uuidSchema.default(() => crypto.randomUUID()),
    originalAmount: purchaseFields.originalAmount.optional(),
    originalCurrency: currencySchema.default('JPY'),
    price: z
      .union([z.string(), z.number().int().positive().max(999_999_999)])
      .transform(String)
      .pipe(amountSchema)
      .refine((value) => !value.includes('.'), 'JPY must be a whole number.')
      .optional(),
    purchaserId: purchaseFields.purchaserId.optional(),
    purchaser: z.string().trim().min(1).max(60).optional(),
    description: purchaseFields.description.default(''),
    purchasedAt: purchaseFields.purchasedAt.optional(),
    exchangeRate: purchaseFields.exchangeRate.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    checkJpyPrecision(input, context);
    if (input.price === undefined && input.originalAmount === undefined) {
      context.addIssue({ code: 'custom', path: ['price'], message: 'Enter a price in yen.' });
    }
    if (input.price !== undefined && input.originalAmount !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['price'],
        message: 'Supply price or originalAmount, not both.',
      });
    }
    if (input.price !== undefined && input.originalCurrency !== 'JPY') {
      context.addIssue({
        code: 'custom',
        path: ['price'],
        message: 'price is always in JPY. Use originalAmount for other currencies.',
      });
    }
    if (input.purchaser !== undefined && input.purchaserId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['purchaser'],
        message: 'Supply a purchaser name or purchaserId, not both.',
      });
    }
  })
  .transform(normalizeLocationFields)
  .transform(({ price, purchaser, ...input }) => ({
    ...input,
    originalAmount: normalizeAmount(input.originalAmount ?? price!, input.originalCurrency),
    ...(input.purchaserId === undefined ? { purchaser: (purchaser ?? 'Me').toLowerCase() } : {}),
  }));

export const patchPurchaseSchema = z
  .object({
    ...locationFields,
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
  })
  .transform(normalizeLocationFields);

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

/** Time/rate stay unresolved for retry identity. Retain the creation UUID across retries. */
export function canonicalCreationInput(input: z.input<typeof createPurchaseSchema>): string {
  const validated = createPurchaseSchema.parse(input);
  return JSON.stringify({
    id: validated.id,
    name: validated.name,
    originalAmount: validated.originalAmount,
    originalCurrency: validated.originalCurrency,
    purchaserId: validated.purchaserId,
    description: validated.description,
    ...(validated.purchaser !== undefined ? { purchaser: validated.purchaser } : {}),
    ...(validated.purchasedAt !== undefined ? { purchasedAt: validated.purchasedAt } : {}),
    ...(validated.exchangeRate !== undefined ? { exchangeRate: validated.exchangeRate } : {}),
    ...(validated.location ? { location: validated.location } : {}),
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

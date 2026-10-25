import type { z } from 'zod';
import type {
  createPurchaseSchema,
  patchPurchaseSchema,
  purchaserCreateSchema,
  purchaserPatchSchema,
  settingsPatchSchema,
  purchaseFiltersSchema,
  summaryFiltersSchema,
} from './schemas';

export type Currency = 'JPY' | 'THB';
export type RateSource = 'default' | 'manual';
export type PurchaseCreate = z.infer<typeof createPurchaseSchema>;
export type PurchasePatch = z.infer<typeof patchPurchaseSchema>;
export type PurchaserCreate = z.infer<typeof purchaserCreateSchema>;
export type PurchaserPatch = z.infer<typeof purchaserPatchSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type PurchaseFilters = z.infer<typeof purchaseFiltersSchema>;
export type SummaryFilters = z.infer<typeof summaryFiltersSchema>;

export interface Settings {
  defaultThbPerJpy: string | null;
  version: number;
  updatedAt: string;
  timezone: 'Asia/Tokyo';
}

export interface Purchaser {
  id: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Purchase {
  id: string;
  name: string;
  description: string;
  purchaserId: string;
  purchaser: Pick<Purchaser, 'id' | 'name' | 'archived'>;
  originalCurrency: Currency;
  originalAmount: string;
  exchangeRate: string;
  rateSource: RateSource;
  amountJpy: string;
  amountThb: string;
  purchasedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CurrencyTotals {
  jpy: string;
  thb: string;
}

export interface DayTotal extends CurrencyTotals {
  date: string;
  count: number;
}

export interface PurchaserTotal extends CurrencyTotals {
  purchaserId: string;
  name: string;
  count: number;
}

export interface Summary {
  timezone: 'Asia/Tokyo';
  count: number;
  totals: CurrencyTotals;
  byDay: DayTotal[];
  byPurchaser: PurchaserTotal[];
}

export interface ApiResponse<T> {
  data: T;
}
export interface PurchaseList extends ApiResponse<Purchase[]> {
  page: { nextCursor: string | null };
}
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
}

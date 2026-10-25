import { createContext, useContext } from 'react';
import type { Currency, Purchase } from '../../shared/types';

export type Filters = { from: string; to: string; purchaserId: string; q: string; preset: string };
export type AppState = {
  currency: Currency;
  setCurrency: (value: Currency) => void;
  filters: Filters;
  setFilters: (value: Filters) => void;
  openPurchase: (purchase?: Purchase) => void;
  notify: (message: string) => void;
};
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('App provider is required');
  return context;
}

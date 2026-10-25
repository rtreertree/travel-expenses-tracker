import { AlertCircle, ArrowRight, Check, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const message =
    error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={19} aria-hidden="true" />
      <div>
        <strong>
          {error instanceof ApiError && error.code === 'VERSION_CONFLICT'
            ? 'This record has changed on another device.'
            : 'Unable to complete the request'}
        </strong>
        <p>{message}</p>
        {error instanceof ApiError && Object.keys(error.fieldErrors).length > 0 && (
          <ul>
            {Object.entries(error.fieldErrors).map(([key, errors]) => (
              <li key={key}>
                {key}: {errors.join(' ')}
              </li>
            ))}
          </ul>
        )}
        {retry && (
          <button type="button" className="text-button" onClick={retry}>
            <RefreshCw size={14} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function Loading({ label = 'Loading your ledger…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={28} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Saved({ children }: { children: ReactNode }) {
  return (
    <span className="saved">
      <Check size={14} />
      {children}
    </span>
  );
}
export function ArrowLink({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ArrowRight size={15} />
    </>
  );
}

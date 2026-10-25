/** Try a quick, recent position before requesting a more expensive GPS fix. */
export const LOCATION_ATTEMPTS: readonly PositionOptions[] = [
  { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 },
  { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 },
];

export function getDeviceLocation(
  provider: Pick<Geolocation, 'getCurrentPosition'>,
  { signal, onRetry }: { signal: AbortSignal; onRetry?: () => void },
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      action();
    }
    function abort() {
      finish(() => reject(new DOMException('Location request canceled.', 'AbortError')));
    }
    function request(index: number) {
      if (signal.aborted) {
        abort();
        return;
      }
      const currentAttempt = ++attempt;
      const current = () => !settled && !signal.aborted && attempt === currentAttempt;
      try {
        provider.getCurrentPosition(
          (position) => {
            if (current()) finish(() => resolve(position));
          },
          (error) => {
            if (!current()) return;
            if (index === 0 && (error.code === 2 || error.code === 3)) {
              onRetry?.();
              request(1);
            } else finish(() => reject(error));
          },
          LOCATION_ATTEMPTS[index],
        );
      } catch (error) {
        if (current()) finish(() => reject(error));
      }
    }
    signal.addEventListener('abort', abort, { once: true });
    request(0);
  });
}

export function locationErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 1)
    return 'Location permission was not granted. Allow location for this site in your browser and enable Location Services on your device, or paste a location.';
  if (code === 3)
    return 'Your device did not return a location after two attempts. Check that Location Services and Wi-Fi are enabled, then try again. You can also paste coordinates or a Maps link.';
  if (code === 2)
    return 'Your device could not determine its location. Check Location Services, Wi-Fi and your connection, then try again or paste a location.';
  return 'Location is unavailable in this browser. Check its location permission or paste coordinates or a Maps link.';
}

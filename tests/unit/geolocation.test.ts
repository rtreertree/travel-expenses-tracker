import { describe, expect, it, vi } from 'vitest';
import {
  getDeviceLocation,
  LOCATION_ATTEMPTS,
  locationErrorMessage,
} from '../../src/client/lib/geolocation';

function harness() {
  const success: PositionCallback[] = [];
  const failure: PositionErrorCallback[] = [];
  const provider = {
    getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>((ok, fail) => {
      success.push(ok);
      if (fail) failure.push(fail);
    }),
  };
  const controller = new AbortController();
  const onRetry = vi.fn();
  const result = getDeviceLocation(provider, { signal: controller.signal, onRetry });
  return { provider, controller, onRetry, result, success, failure };
}
const position = {
  coords: { latitude: 35.6812, longitude: 139.7671, accuracy: 50 },
  timestamp: 123,
} as GeolocationPosition;
const error = (code: number) => ({ code, message: 'Device error' }) as GeolocationPositionError;

describe('device location acquisition', () => {
  it('starts with a recent, lower-power fix and a longer timeout', async () => {
    const test = harness();
    expect(test.provider.getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 20_000,
      maximumAge: 60_000,
    });
    test.success[0]!(position);
    expect(await test.result).toBe(position);
    expect(test.provider.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(test.onRetry).not.toHaveBeenCalled();
  });

  it.each([2, 3])(
    'retries availability/timeout code %i once and ignores late first results',
    async (code) => {
      const test = harness();
      test.failure[0]!(error(code));
      expect(test.onRetry).toHaveBeenCalledOnce();
      expect(test.provider.getCurrentPosition.mock.calls[1]?.[2]).toEqual(LOCATION_ATTEMPTS[1]);
      test.success[0]!({ ...position, timestamp: 1 });
      test.success[1]!(position);
      expect(await test.result).toBe(position);
      expect(test.provider.getCurrentPosition).toHaveBeenCalledTimes(2);
    },
  );

  it('does not retry a denied permission', async () => {
    const test = harness();
    const rejection = expect(test.result).rejects.toMatchObject({ code: 1 });
    test.failure[0]!(error(1));
    await rejection;
    expect(test.provider.getCurrentPosition).toHaveBeenCalledOnce();
    expect(test.onRetry).not.toHaveBeenCalled();
  });

  it('stops after the second failure with actionable device guidance', async () => {
    const test = harness();
    const rejection = expect(test.result).rejects.toMatchObject({ code: 3 });
    test.failure[0]!(error(3));
    test.failure[1]!(error(3));
    await rejection;
    expect(test.provider.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(locationErrorMessage(error(3))).toContain('Location Services and Wi-Fi');
  });

  it('cancels without requesting more GPS data or accepting stale callbacks', async () => {
    const test = harness();
    const rejection = expect(test.result).rejects.toMatchObject({ name: 'AbortError' });
    test.controller.abort();
    test.failure[0]!(error(3));
    test.success[0]!(position);
    await rejection;
    expect(test.provider.getCurrentPosition).toHaveBeenCalledOnce();
    expect(test.onRetry).not.toHaveBeenCalled();
  });

  it('does not begin a request if already canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = { getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>() };
    await expect(getDeviceLocation(provider, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(provider.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('can cancel when fallback begins, without starting another request', async () => {
    const controller = new AbortController();
    const provider = {
      getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>((_, fail) => fail?.(error(3))),
    };
    await expect(
      getDeviceLocation(provider, { signal: controller.signal, onRetry: () => controller.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(provider.getCurrentPosition).toHaveBeenCalledOnce();
  });

  it('handles browsers that throw synchronously and gives distinct permission advice', async () => {
    const provider = {
      getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>(() => {
        throw new Error('Unsupported');
      }),
    };
    await expect(
      getDeviceLocation(provider, { signal: new AbortController().signal }),
    ).rejects.toThrow('Unsupported');
    expect(locationErrorMessage(error(1))).toContain('Allow location for this site');
    expect(locationErrorMessage(error(2))).toContain('could not determine');
  });
});

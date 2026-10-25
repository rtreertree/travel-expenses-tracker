import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, MapPin } from 'lucide-react';
import type { PurchaseLocation } from '../../shared/types';
import { parseLocation } from '../../shared/location';
import { getDeviceLocation, locationErrorMessage } from '../lib/geolocation';

/** Only the canonical Google Maps URL is navigable; user text remains plain text. */
function mapsHref(location: PurchaseLocation): string {
  // Re-parse stored fields so a forged googleMapsUrl is never trusted, while
  // allowlisted short map links retain their original destination.
  try {
    return parseLocation(location)?.googleMapsUrl ?? 'https://www.google.com/maps';
  } catch {
    return 'https://www.google.com/maps';
  }
}

function coordinateText(location: PurchaseLocation) {
  return location.latitude !== null && location.longitude !== null
    ? `${location.latitude}, ${location.longitude}`
    : null;
}

export function LocationDisplay({
  location,
  compact = false,
}: {
  location: PurchaseLocation;
  compact?: boolean;
}) {
  const coordinates = coordinateText(location);
  if (compact) {
    return (
      <div className="purchase-location-summary">
        <MapPin size={13} aria-hidden="true" />
        <span title={location.text ?? coordinates ?? 'Location saved'}>
          {location.text || coordinates || 'Location saved'}
        </span>
        <a href={mapsHref(location)} target="_blank" rel="noopener noreferrer">
          Maps <ExternalLink size={11} aria-hidden="true" />
        </a>
      </div>
    );
  }
  return (
    <div className="location-display">
      <div className="location-display-heading">
        <MapPin size={15} aria-hidden="true" />
        <strong>Purchase location</strong>
      </div>
      {location.text && <p className="location-plain-text">{location.text}</p>}
      {coordinates && <p className="location-coordinates">Coordinates: {coordinates}</p>}
      <a href={mapsHref(location)} target="_blank" rel="noopener noreferrer">
        Open in Google Maps <ExternalLink size={13} aria-hidden="true" />
      </a>
    </div>
  );
}

export function LocationField({
  value,
  onChange,
  disabled = false,
  storedLocation,
  storedValue,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  storedLocation?: PurchaseLocation | null;
  storedValue?: string;
}) {
  const [gpsState, setGpsState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [gpsError, setGpsError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const gpsRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      gpsRequest.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    if (disabled) {
      requestGeneration.current += 1;
      gpsRequest.current?.abort();
      // A save supersedes a pending GPS request; a failed save can request GPS again.
      queueMicrotask(() => {
        if (mounted.current) setGpsState('idle');
      });
    }
  }, [disabled]);
  let location: PurchaseLocation | null = null;
  let parseError = '';
  try {
    location = parseLocation(storedLocation && value === storedValue ? storedLocation : value);
  } catch (error) {
    parseError = error instanceof Error ? error.message : 'Check the location format.';
  }
  const coordinates = location ? coordinateText(location) : null;
  function editLocation(next: string) {
    requestGeneration.current += 1;
    gpsRequest.current?.abort();
    setGpsState('idle');
    setGpsError('');
    setRetrying(false);
    setAccuracy(null);
    onChange(next);
  }
  function cancelLocation() {
    requestGeneration.current += 1;
    gpsRequest.current?.abort();
    setGpsState('idle');
    setGpsError('');
    setRetrying(false);
  }
  async function captureLocation() {
    if (disabled) return;
    gpsRequest.current?.abort();
    const generation = ++requestGeneration.current;
    if (!window.isSecureContext) {
      setGpsState('error');
      setGpsError(
        'Device location needs a secure connection. Open the app using HTTPS, or paste coordinates or a Maps link.',
      );
      return;
    }
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsError(
        'This browser does not support location. You can paste a place or coordinates instead.',
      );
      return;
    }
    setGpsState('pending');
    setGpsError('');
    setRetrying(false);
    setAccuracy(null);
    const controller = new AbortController();
    gpsRequest.current = controller;
    try {
      const position = await getDeviceLocation(navigator.geolocation, {
        signal: controller.signal,
        onRetry: () => {
          if (mounted.current && generation === requestGeneration.current) setRetrying(true);
        },
      });
      if (!mounted.current || generation !== requestGeneration.current || controller.signal.aborted)
        return;
      onChange(`${position.coords.latitude}, ${position.coords.longitude}`);
      setAccuracy(
        Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
      );
      setGpsState('success');
    } catch (error) {
      if (!mounted.current || generation !== requestGeneration.current || controller.signal.aborted)
        return;
      setGpsState('error');
      setGpsError(locationErrorMessage(error));
    }
  }
  return (
    <div className="location-field">
      <div className="location-field-heading">
        <label htmlFor="purchase-location" id="purchase-location-label">
          Location (optional)
        </label>
        <button
          type="button"
          className="text-button"
          disabled={disabled || gpsState === 'pending'}
          onClick={() => {
            void captureLocation();
          }}
        >
          <LocateFixed size={15} aria-hidden="true" />
          {gpsState === 'pending' ? 'Finding location…' : 'Use current location'}
        </button>
      </div>
      <textarea
        id="purchase-location"
        name="location"
        disabled={disabled}
        rows={2}
        value={value}
        aria-describedby="location-help location-preview-status"
        aria-invalid={!!parseError}
        placeholder={'Place, coordinates, Maps link, or JSON\ne.g. 35.681236, 139.767125'}
        onChange={(event) => editLocation(event.target.value)}
      />
      <p className="field-hint" id="location-help">
        Paste a place, coordinates, a map link, or a location object. Places and short links open in
        Maps; coordinates are saved only when supplied or captured with the button above.
      </p>
      <div id="location-preview-status" aria-live="polite">
        {parseError && <p className="location-feedback location-error">{parseError}</p>}
        {gpsState === 'pending' && (
          <p className="location-feedback" role="status">
            {retrying
              ? 'Still locating you. Retrying with a more accurate fix…'
              : 'Waiting for your browser’s location permission and device location…'}{' '}
            <button type="button" className="text-button" onClick={cancelLocation}>
              Cancel location request
            </button>
          </p>
        )}
        {gpsError && (
          <p className="location-feedback location-error" role="alert">
            {gpsError}
          </p>
        )}
        {gpsState === 'success' && (
          <p className="location-feedback">
            Current coordinates captured
            {accuracy !== null ? ` (estimated accuracy ±${accuracy} m)` : ''}. Review the map before
            saving.
          </p>
        )}
        {location && (
          <div className="location-preview">
            <div>
              <MapPin size={16} aria-hidden="true" />
              <strong>{coordinates ? `Coordinates: ${coordinates}` : 'Map reference ready'}</strong>
            </div>
            {!coordinates && (
              <p>No coordinates extracted. This place or link can still open in Google Maps.</p>
            )}
            <a href={mapsHref(location)} target="_blank" rel="noopener noreferrer">
              Preview in Google Maps <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

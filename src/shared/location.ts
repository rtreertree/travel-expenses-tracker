import type { PurchaseLocation } from './types';

export const MAX_LOCATION_TEXT = 2_000;
export const MAX_MAPS_URL = 2_048;
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const PAIR = new RegExp(`^\\s*\\(?\\s*(${NUMBER})\\s*(?:,|;|\\s)\\s*(${NUMBER})\\s*\\)?\\s*$`);
const invalid = (
  message = 'Enter valid latitude and longitude, a map link, or a place name.',
): never => {
  throw new Error(message);
};

function coordinate(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string')
    return invalid('Coordinates must be finite numbers.');
  if (typeof value === 'string' && !new RegExp(`^${NUMBER}$`).test(value.trim()))
    return invalid('Coordinates must be finite numbers.');
  const result = Number(value);
  if (!Number.isFinite(result)) return invalid('Coordinates must be finite numbers.');
  return result;
}

function stable(value: number): number {
  const rounded = Number(value.toFixed(7));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function boundedText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return invalid('The location label must be text.');
  const text = value.trim();
  if (text.length > MAX_LOCATION_TEXT)
    return invalid(`Location must be at most ${MAX_LOCATION_TEXT} characters.`);
  if (
    [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  )
    return invalid('Location contains invalid control characters.');
  return text || null;
}

function checkedUrl(url: URL): string {
  if (url.href.length > MAX_MAPS_URL)
    return invalid('The Google Maps link would be too long. Shorten the location text.');
  return url.href;
}

export function googleMapsSearchUrl(query: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.search = new URLSearchParams({ api: '1', query }).toString();
  return checkedUrl(url);
}

function place(text: string): PurchaseLocation {
  boundedText(text);
  return { text, latitude: null, longitude: null, googleMapsUrl: googleMapsSearchUrl(text) };
}

function point(
  first: unknown,
  second: unknown,
  text: string | null = null,
  allowReverse = false,
): PurchaseLocation {
  let latitude = coordinate(first);
  let longitude = coordinate(second);
  if (
    allowReverse &&
    Math.abs(latitude) > 90 &&
    Math.abs(latitude) <= 180 &&
    Math.abs(longitude) <= 90
  ) {
    [latitude, longitude] = [longitude, latitude];
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    return invalid('Latitude must be between -90 and 90; longitude must be between -180 and 180.');
  latitude = stable(latitude);
  longitude = stable(longitude);
  return {
    text,
    latitude,
    longitude,
    googleMapsUrl: googleMapsSearchUrl(
      `${latitude.toFixed(7).replace(/\.?0+$/, '')},${longitude.toFixed(7).replace(/\.?0+$/, '')}`,
    ),
  };
}

function decimalPair(text: string, allowReverse = true): PurchaseLocation | null {
  const matched = PAIR.exec(text);
  return matched ? point(matched[1], matched[2], null, allowReverse) : null;
}

function dms(text: string): PurchaseLocation | null {
  if (!/[NSEW]/i.test(text) || !/\d/.test(text)) return null;
  const cleaned = text
    .replace(/[°º′'″",;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const variants = [
    new RegExp(`(${NUMBER}(?:\\s+\\d+(?:\\.\\d+)?){0,2})\\s*([NSEW])\\b`, 'gi'),
    new RegExp(`\\b([NSEW])\\s*(${NUMBER}(?:\\s+\\d+(?:\\.\\d+)?){0,2})`, 'gi'),
  ];
  for (let variant = 0; variant < variants.length; variant++) {
    const regex = variants[variant]!;
    const matches = [...cleaned.matchAll(regex)];
    if (matches.length !== 2 || cleaned.replace(regex, '').trim()) continue;
    const values: { latitude?: number; longitude?: number } = {};
    for (const match of matches) {
      const hemisphere = (variant === 0 ? match[2] : match[1])!.toUpperCase();
      const parts = (variant === 0 ? match[1] : match[2])!.split(/\s+/).map(Number);
      const degrees = parts[0]!;
      const minutes = parts[1] ?? 0;
      const seconds = parts[2] ?? 0;
      if (minutes >= 60 || seconds >= 60 || (parts.length > 1 && !Number.isInteger(degrees)))
        return invalid('Coordinate minutes and seconds must be below 60, with whole degrees.');
      if (degrees < 0 && /[NE]/.test(hemisphere))
        return invalid('Coordinate sign conflicts with its hemisphere.');
      const value =
        (Math.abs(degrees) + minutes / 60 + seconds / 3_600) * (/[SW]/.test(hemisphere) ? -1 : 1);
      const axis = /[NS]/.test(hemisphere) ? 'latitude' : 'longitude';
      if (values[axis] !== undefined) return invalid('Supply one latitude and one longitude.');
      values[axis] = value;
    }
    return point(values.latitude, values.longitude);
  }
  if (/^[\d+\-\s°º′'″",;.NSEW]+$/i.test(text) && /[NSEW]/i.test(text))
    return invalid('Use valid degrees, minutes and seconds with N/S and E/W.');
  return null;
}

function labelled(text: string): PurchaseLocation | null {
  const regex = new RegExp(`\\b(latitude|longitude|lat|lng|lon)\\s*[:=]\\s*(${NUMBER})`, 'gi');
  const matches = [...text.matchAll(regex)];
  if (!matches.length) {
    if (/\b(?:latitude|longitude|lat|lng|lon)\s*[:=]/i.test(text))
      return invalid('Supply a numeric latitude and longitude.');
    return null;
  }
  if (matches.length !== 2 || text.replace(regex, '').replace(/[,;\s]/g, ''))
    return invalid('Supply one numeric latitude and one longitude.');
  const values: { latitude?: string; longitude?: string } = {};
  for (const match of matches) {
    const axis = /^(lat|latitude)$/i.test(match[1]!) ? 'latitude' : 'longitude';
    if (values[axis] !== undefined) return invalid('Supply one latitude and one longitude.');
    values[axis] = match[2];
  }
  return point(values.latitude, values.longitude);
}

function mapHost(host: string): boolean {
  return /^(?:www\.|maps\.)?google\.(?:com|co\.jp|co\.th|co\.uk|com\.au|ca|de|fr|es|it|co\.in|co\.nz|com\.sg|com\.tw|com\.hk)$/.test(
    host,
  );
}

function mapLink(raw: string, depth: number): PurchaseLocation {
  let url: URL;
  try {
    url = new URL(raw.startsWith('www.') ? `https://${raw}` : raw);
  } catch {
    return invalid('Enter a valid map URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return invalid('Only trusted web map links are accepted.');
  if (url.username || url.password || url.port)
    return invalid('Map links cannot contain credentials or custom ports.');
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && /^\/maps(?:\/|$)/.test(url.pathname))) {
    url.protocol = 'https:';
    const safe = checkedUrl(url);
    return { text: raw, latitude: null, longitude: null, googleMapsUrl: safe };
  }
  const google = mapHost(host);
  const apple = host === 'maps.apple.com';
  const osm = host === 'openstreetmap.org' || host === 'www.openstreetmap.org';
  if (!google && !apple && !osm)
    return invalid('Use a Google Maps, Apple Maps, or OpenStreetMap link, or paste a place name.');
  if (google && !host.startsWith('maps.') && !/^\/maps(?:\/|$)/.test(url.pathname))
    return invalid('Use a Google Maps link.');
  function originalGoogleLink(): PurchaseLocation {
    url.protocol = 'https:';
    return { text: raw, latitude: null, longitude: null, googleMapsUrl: checkedUrl(url) };
  }

  if (google) {
    // Pin coordinates outrank URL query destinations, which outrank camera position.
    const pin = /!3d([+-]?[\d.]+)!4d([+-]?[\d.]+)/.exec(url.pathname + url.search);
    if (pin) return point(pin[1], pin[2]);
    const pinReversed = /!4d([+-]?[\d.]+)!3d([+-]?[\d.]+)/.exec(url.pathname + url.search);
    if (pinReversed) return point(pinReversed[2], pinReversed[1]);
    const hasPlaceReference = ['cid', 'ftid', 'query_place_id'].some((key) =>
      url.searchParams.has(key),
    );
    for (const key of ['query', 'q', 'destination', 'daddr', 'll']) {
      const value = url.searchParams.get(key);
      if (value) {
        const result = decimalPair(value) ?? labelled(value) ?? dms(value);
        return result ?? (hasPlaceReference ? originalGoogleLink() : place(value));
      }
    }
    if (hasPlaceReference) return originalGoogleLink();
    const camera = /@([+-]?[\d.]+),([+-]?[\d.]+)/.exec(url.pathname);
    if (camera) return point(camera[1], camera[2]);
    const pathPlace = /\/maps\/(?:place|search)\/([^/]+)/.exec(url.pathname);
    if (pathPlace) {
      let label: string;
      try {
        label = decodeURIComponent(pathPlace[1]!).replace(/\+/g, ' ');
      } catch {
        return invalid('The map URL contains invalid encoding.');
      }
      return decimalPair(label) ?? originalGoogleLink();
    }
    return originalGoogleLink();
  }
  if (apple) {
    for (const key of ['ll', 'sll', 'coordinate', 'q', 'daddr']) {
      const value = url.searchParams.get(key);
      if (value) return decimalPair(value, false) ?? place(value);
    }
  }
  if (osm) {
    if (url.searchParams.has('mlat') || url.searchParams.has('mlon'))
      return point(url.searchParams.get('mlat'), url.searchParams.get('mlon'));
    const hash = /^#map=\d+(?:\.\d+)?\/([+-]?[\d.]+)\/([+-]?[\d.]+)/.exec(url.hash);
    if (hash) return point(hash[1], hash[2]);
    const query = url.searchParams.get('query');
    if (query) return decimalPair(query) ?? place(query);
  }
  if (depth > 2) return invalid('The location is nested too deeply.');
  return place(raw);
}

function recordPoint(input: Record<string, unknown>, depth: number): PurchaseLocation | null {
  if (input.type === 'Feature' && input.geometry) return parse(input.geometry, depth + 1);
  if (input.type === 'Point') {
    if (
      !Array.isArray(input.coordinates) ||
      input.coordinates.length < 2 ||
      input.coordinates.length > 3
    )
      return invalid('A GeoJSON Point needs longitude and latitude.');
    if (input.coordinates.length === 3) coordinate(input.coordinates[2]);
    return point(input.coordinates[1], input.coordinates[0]);
  }
  if (input.coords !== undefined) return parse(input.coords, depth + 1);
  if (input.location !== undefined || input.gps !== undefined)
    return parse(input.location ?? input.gps, depth + 1);
  const label = boundedText(input.text ?? input.label ?? input.address ?? input.place);
  const lat = input.latitude ?? input.lat;
  const lon = input.longitude ?? input.lng ?? input.lon;
  if ((lat !== undefined && lat !== null) || (lon !== undefined && lon !== null)) {
    const result = point(lat, lon, label);
    for (const alias of ['latitude', 'lat'])
      if (
        input[alias] !== undefined &&
        input[alias] !== null &&
        stable(coordinate(input[alias])) !== result.latitude
      )
        return invalid('Latitude fields disagree.');
    for (const alias of ['longitude', 'lng', 'lon'])
      if (
        input[alias] !== undefined &&
        input[alias] !== null &&
        stable(coordinate(input[alias])) !== result.longitude
      )
        return invalid('Longitude fields disagree.');
    return result;
  }
  // A normalized object is re-parseable; supplied googleMapsUrl is never trusted.
  if (label) return parse(label, depth + 1);
  if (
    Object.keys(input).every((key) =>
      ['text', 'latitude', 'longitude', 'googleMapsUrl'].includes(key),
    )
  )
    return null;
  return invalid('Use latitude/longitude, lat/lng, GeoJSON Point, or a place name.');
}

function parse(value: unknown, depth: number): PurchaseLocation | null {
  if (depth > 4) return invalid('The location is nested too deeply.');
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length !== 2)
      return invalid('A coordinate pair needs two values: latitude, longitude.');
    return point(value[0], value[1], null, true);
  }
  if (typeof value === 'object') return recordPoint(value as Record<string, unknown>, depth);
  if (typeof value !== 'string')
    return invalid('Location must be text, a coordinate pair, or a coordinate object.');
  const text = boundedText(value);
  if (!text) return null;
  if (/^[[{]/.test(text)) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      return invalid('The pasted location JSON is invalid.');
    }
    return parse(decoded, depth + 1);
  }
  if (/^geo:/i.test(text)) {
    const match = new RegExp(`^geo:(${NUMBER}),(${NUMBER})(?:,${NUMBER})?(?:[;?].*)?$`, 'i').exec(
      text,
    );
    if (!match) return invalid('Use a valid geo:latitude,longitude URI.');
    const queryIndex = text.indexOf('?');
    const query = queryIndex >= 0 ? new URLSearchParams(text.slice(queryIndex + 1)).get('q') : null;
    if (query && match[1] === '0' && match[2] === '0')
      return decimalPair(query.replace(/\([^)]*\)$/, '').trim()) ?? place(query);
    return point(match[1], match[2]);
  }
  if (/^POINT\s*\(/i.test(text)) {
    const match = new RegExp(`^POINT\\s*\\(\\s*(${NUMBER})\\s+(${NUMBER})\\s*\\)$`, 'i').exec(text);
    if (!match) return invalid('Use WKT POINT (longitude latitude).');
    return point(match[2], match[1]);
  }
  const coordinates = decimalPair(text) ?? labelled(text) ?? dms(text);
  if (coordinates) return coordinates;
  if (/^(?:https?:\/\/|www\.)/i.test(text)) return mapLink(text, depth);
  if (/^[a-z][a-z\d+.-]*:/i.test(text))
    return invalid('Use a trusted map link or a plain place name.');
  if (
    /^[\d+\-.,;()\s]+$/.test(text) ||
    /^(?:NaN|Infinity)\b/i.test(text) ||
    new RegExp(`^\\(?\\s*${NUMBER}\\s*[,;]`).test(text) ||
    new RegExp(`^${NUMBER}\\s+${NUMBER}\\s`).test(text)
  )
    return invalid('The coordinate pair is incomplete or invalid.');
  return place(text);
}

/** Parse common copied GPS/map formats without fetching URLs or geocoding places. */
export function parseLocation(value: unknown): PurchaseLocation | null {
  return parse(value, 0);
}

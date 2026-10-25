import { describe, expect, it } from 'vitest';
import { googleMapsSearchUrl, parseLocation } from '../../src/shared/location';
import {
  canonicalCreationInput,
  createPurchaseSchema,
  hashCreateRequest,
  patchPurchaseSchema,
} from '../../src/shared/schemas';

const tokyo = { latitude: 35.6762, longitude: 139.6503 };
const base = { id: '4903709b-cea6-4cb8-9ff4-6362805444db', name: 'Lunch', price: 1500 };

describe('common GPS input formats', () => {
  it.each([
    '35.6762, 139.6503',
    '(35.6762;139.6503)',
    '35.6762 139.6503',
    '139.6503,35.6762',
    'latitude: 35.6762, longitude: 139.6503',
    'lng=139.6503;lat=35.6762',
    '35.6762°N 139.6503°E',
    'N35.6762 E139.6503',
    'geo:35.6762,139.6503',
    'geo:35.6762,139.6503,20;u=10',
    'POINT (139.6503 35.6762)',
    '[35.6762,139.6503]',
    '{"lat":35.6762,"lng":139.6503}',
  ])('normalizes %s', (input) => {
    expect(parseLocation(input)).toMatchObject({ ...tokyo, text: null });
    const url = new URL(parseLocation(input)!.googleMapsUrl);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.searchParams.get('query')).toBe('35.6762,139.6503');
    expect(url.searchParams.get('api')).toBe('1');
  });

  it.each([
    [35.6762, 139.6503],
    { lat: 35.6762, lng: 139.6503 },
    { latitude: '35.6762', longitude: '139.6503' },
    { coords: { latitude: 35.6762, longitude: 139.6503, accuracy: 15 } },
    { type: 'Point', coordinates: [139.6503, 35.6762] },
    { type: 'Point', coordinates: [139.6503, 35.6762, 50] },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [139.6503, 35.6762] } },
  ])('accepts native and GeoJSON coordinate objects %#', (input) => {
    expect(parseLocation(input)).toMatchObject(tokyo);
  });

  it('converts DMS and DDM, preserving hemispheres and stable precision', () => {
    expect(parseLocation('35°40\'34.7"N 139°45\'49.9"E')).toMatchObject({
      latitude: 35.6763056,
      longitude: 139.7638611,
    });
    expect(parseLocation('S 33 51.5 W 151 12.5')).toMatchObject({
      latitude: -33.8583333,
      longitude: -151.2083333,
    });
    expect(parseLocation('33 51 30 S 151 12 30 E')).toMatchObject({
      latitude: -33.8583333,
      longitude: 151.2083333,
    });
    expect(parseLocation('-0,0')).toMatchObject({ latitude: 0, longitude: 0 });
    expect(parseLocation({ lat: 35.123456789, lng: 139.123456789 })).toMatchObject({
      latitude: 35.1234568,
      longitude: 139.1234568,
    });
    const tiny = parseLocation({ latitude: 0.0000001, longitude: -0.0000001 });
    expect(new URL(tiny!.googleMapsUrl).searchParams.get('query')).toBe('0.0000001,-0.0000001');
    expect(parseLocation(tiny!.googleMapsUrl)).toEqual(tiny);
  });

  it('honors explicit coordinate ordering instead of swapping named fields or GeoJSON', () => {
    expect(parseLocation('30,40')).toMatchObject({ latitude: 30, longitude: 40 });
    expect(parseLocation({ type: 'Point', coordinates: [30, 40] })).toMatchObject({
      latitude: 40,
      longitude: 30,
    });
    expect(parseLocation('POINT (30 40)')).toMatchObject({ latitude: 40, longitude: 30 });
    expect(() => parseLocation({ latitude: 139, longitude: 35 })).toThrow();
    expect(() => parseLocation({ type: 'Point', coordinates: [35, 139] })).toThrow();
  });

  it.each([
    '1e-7,-1e-7',
    '+1e-7, -1E-7',
    { latitude: '1e-7', longitude: '-1e-7' },
    { lat: '+1E-7', lng: '-1e-7' },
    { coords: { latitude: 1e-7, longitude: -1e-7 } },
  ])('accepts finite scientific GPS notation without changing serialized precision %#', (input) => {
    const normalized = parseLocation(input);
    expect(normalized).toMatchObject({ latitude: 0.0000001, longitude: -0.0000001 });
    expect(new URL(normalized!.googleMapsUrl).searchParams.get('query')).toBe(
      '0.0000001,-0.0000001',
    );
    expect(parseLocation(normalized)).toEqual(normalized);
  });

  it.each([
    '1e309,139',
    '-1e309,139',
    '35,+1e309',
    { latitude: '1e309', longitude: '139' },
    { latitude: 35, longitude: '-1E309' },
  ])('rejects overflowing scientific coordinates %#', (input) => {
    expect(() => parseLocation(input)).toThrow(/finite/);
  });
});

describe('trusted map links', () => {
  it.each([
    'https://www.google.com/maps/search/?api=1&query=35.6762%2C139.6503',
    'https://maps.google.com/?q=35.6762,139.6503',
    'https://www.google.co.jp/maps/dir/?api=1&destination=35.6762,139.6503',
    'https://www.google.com/maps/@35.6762,139.6503,15z',
    'https://maps.apple.com/?ll=35.6762,139.6503&q=Tokyo',
    'https://maps.apple.com/?q=35.6762,139.6503',
    'https://www.openstreetmap.org/#map=17/35.6762/139.6503',
    'https://www.openstreetmap.org/?mlat=35.6762&mlon=139.6503',
    'geo:0,0?q=35.6762,139.6503(Tokyo)',
  ])('extracts coordinates from %s', (input) => {
    expect(parseLocation(input)).toMatchObject(tokyo);
  });

  it('prefers Google place pin coordinates over camera and query coordinates', () => {
    const input =
      'https://www.google.com/maps/place/Tokyo/@34,135,15z/data=!3d35.6762!4d139.6503?q=33,134';
    expect(parseLocation(input)).toMatchObject(tokyo);
    expect(
      parseLocation('https://www.google.com/maps/@34,135,15z?q=35.6762,139.6503'),
    ).toMatchObject(tokyo);
    expect(
      parseLocation('https://www.google.com/maps/@34,135,15z/data=!4d139.6503!3d35.6762?q=33,134'),
    ).toMatchObject(tokyo);
  });

  it('retains vetted Google place-reference links when coordinates are unavailable', () => {
    for (const input of [
      'https://www.google.com/maps?cid=12345',
      'https://www.google.com/maps?ftid=0x1234:0x5678',
      'https://www.google.com/maps/search/?api=1&query=Tokyo&query_place_id=ChIJ1234',
      'https://www.google.com/maps/place/Tokyo+Tower/',
    ]) {
      expect(parseLocation(input)).toEqual({
        text: input,
        latitude: null,
        longitude: null,
        googleMapsUrl: new URL(input).href,
      });
      expect(parseLocation(parseLocation(input))).toEqual(parseLocation(input));
    }
  });

  it('retains addresses and allowlisted short links without pretending to geocode', () => {
    const address = parseLocation('  東京駅 八重洲口  ');
    expect(address).toMatchObject({ text: '東京駅 八重洲口', latitude: null, longitude: null });
    expect(new URL(address!.googleMapsUrl).searchParams.get('query')).toBe('東京駅 八重洲口');
    expect(parseLocation('https://maps.apple.com/?q=Tokyo%20Station')).toMatchObject({
      text: 'Tokyo Station',
      latitude: null,
      longitude: null,
    });
    for (const input of ['https://maps.app.goo.gl/abcdef', 'https://goo.gl/maps/abcdef']) {
      expect(parseLocation(input)).toEqual({
        text: input,
        latitude: null,
        longitude: null,
        googleMapsUrl: input,
      });
    }
  });

  it('makes normalized values idempotent and ignores forged derived links', () => {
    for (const input of [
      '35.6762,139.6503',
      'Tokyo Station',
      'https://maps.app.goo.gl/abcd',
      { text: 'Tokyo', ...tokyo },
    ]) {
      const result = parseLocation(input);
      expect(parseLocation(result)).toEqual(result);
      expect(parseLocation({ ...result, googleMapsUrl: 'javascript:alert(1)' })).toEqual(result);
    }
  });
});

describe('location safety and validation', () => {
  it.each([
    '91,181',
    '35.6,NaN',
    'NaN,139',
    '35.6,',
    '35.6,banana',
    '35, 139, 20',
    '1 2 3',
    'latitude:no,longitude:139',
    '35 61 N 139 30 E',
    '35 30 60 N 139 30 E',
    '-35 N 139 E',
    '35 N 40 N',
    'geo:35,200',
    'POINT (139)',
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///tmp/map',
    'https://google.com.evil.test/maps/?q=35,139',
    'https://www.google.com/search?q=Tokyo',
    'https://evil.test/?q=35,139',
    'https://goo.gl/not-maps',
    'https://www.google.com:444/maps?q=1,2',
    'https://user:pass@www.google.com/maps?q=1,2',
    '{"lat":35,broken}',
  ])('rejects unsafe or malformed input %s', (input) => {
    expect(() => parseLocation(input)).toThrow();
  });

  it.each([
    true,
    35,
    [35],
    [35, 139, 1],
    { lat: 35 },
    { latitude: Infinity, longitude: 139 },
    { latitude: 35, longitude: 139, lat: 36 },
    { type: 'Point', coordinates: [139, 35, 'bad'] },
  ])('rejects malformed coordinate object %#', (input) => {
    expect(() => parseLocation(input)).toThrow();
  });

  it('enforces text and fully encoded Maps URL limits', () => {
    expect(() => parseLocation('x'.repeat(2001))).toThrow(/2000/);
    expect(() => parseLocation('東'.repeat(300))).toThrow(/too long/);
    expect(googleMapsSearchUrl('Tokyo').length).toBeLessThanOrEqual(2048);
    expect(parseLocation(null)).toBeNull();
    expect(parseLocation('  ')).toBeNull();
  });
});

describe('location request schemas and retry identity', () => {
  it('normalizes aliases to a single optional location field', () => {
    const expected = parseLocation('35.6762,139.6503');
    for (const input of [
      { location: '35.6762,139.6503' },
      { gps: [35.6762, 139.6503] },
      { latitude: 35.6762, longitude: 139.6503 },
      { lat: '35.6762', lng: '139.6503' },
    ]) {
      const parsed = createPurchaseSchema.parse({ ...base, ...input });
      expect(parsed.location).toEqual(expected);
      expect(parsed).not.toHaveProperty('gps');
      expect(parsed).not.toHaveProperty('latitude');
    }
    expect(patchPurchaseSchema.parse({ version: 1, location: null }).location).toBeNull();
    expect(patchPurchaseSchema.parse({ version: 1, name: 'Text only' })).not.toHaveProperty(
      'location',
    );
    expect(
      createPurchaseSchema.safeParse({ ...base, location: 'Tokyo', gps: 'Osaka' }).success,
    ).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, latitude: 35 }).success).toBe(false);
    expect(
      createPurchaseSchema.parse({ ...base, location: 'Tokyo', latitude: 35, longitude: 139 })
        .location,
    ).toEqual(parseLocation({ text: 'Tokyo', latitude: 35, longitude: 139 }));
  });

  it('merges text labels with agreeing GPS sources, rejecting conflicting sources or clear requests', async () => {
    const combined = { ...base, location: 'Tokyo Tower', gps: { lat: 35.6586, lng: 139.7454 } };
    const nested = { ...base, location: { text: 'Tokyo Tower', lat: 35.6586, lng: 139.7454 } };
    expect(createPurchaseSchema.parse(combined).location).toEqual(parseLocation(nested.location));
    expect(await hashCreateRequest(combined)).toBe(await hashCreateRequest(nested));
    expect(
      createPurchaseSchema.safeParse({ ...combined, latitude: 35.6586, longitude: 139.7454 })
        .success,
    ).toBe(true);
    expect(
      createPurchaseSchema.safeParse({ ...combined, latitude: 35, longitude: 139 }).success,
    ).toBe(false);
    expect(
      createPurchaseSchema.safeParse({ ...base, location: null, gps: [35, 139] }).success,
    ).toBe(false);
    expect(
      patchPurchaseSchema.safeParse({ version: 1, location: 'Tokyo', gps: null }).success,
    ).toBe(false);
    expect(
      patchPurchaseSchema.parse({ version: 1, location: 'Tokyo', latitude: 35, longitude: 139 })
        .location,
    ).toMatchObject({ text: 'Tokyo', latitude: 35, longitude: 139 });
  });

  it('preserves pre-location canonical formats for omitted and null locations', async () => {
    const original = canonicalCreationInput(base);
    expect(original).not.toContain('location');
    expect(canonicalCreationInput({ ...base, location: null })).toBe(original);
    expect(canonicalCreationInput({ ...base, gps: '' })).toBe(original);
    expect(await hashCreateRequest({ ...base, location: 'Tokyo' })).not.toBe(
      await hashCreateRequest(base),
    );
  });

  it('equates coordinate spellings and can hash already normalized schema output', async () => {
    const direct = { ...base, location: '35.6762000,139.6503000' };
    const parsed = createPurchaseSchema.parse(direct);
    expect(await hashCreateRequest(direct)).toBe(
      await hashCreateRequest({ ...base, gps: { lat: 35.6762, lng: 139.6503 } }),
    );
    expect(await hashCreateRequest(direct)).toBe(await hashCreateRequest(parsed));
  });
});

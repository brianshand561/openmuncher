import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmac } from '../lambda/shared/hmac.js';

const SECRET = 'test-secret';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifyHmac', () => {
  it('accepts a valid signature', () => {
    const body = '{"x":1}';
    expect(verifyHmac(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    expect(verifyHmac('{"x":1}', sign('{"x":2}'), SECRET)).toBe(false);
  });

  it('rejects malformed hex', () => {
    expect(verifyHmac('{"x":1}', 'not-hex', SECRET)).toBe(false);
  });

  it('rejects empty signature', () => {
    expect(verifyHmac('{"x":1}', '', SECRET)).toBe(false);
  });

  it('uses constant-time compare (does not throw on length mismatch)', () => {
    expect(() => verifyHmac('{"x":1}', 'abcd', SECRET)).not.toThrow();
  });
});

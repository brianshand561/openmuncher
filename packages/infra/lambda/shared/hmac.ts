import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature.length !== expectedHex.length) return false;
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = Buffer.from(signature, 'hex');
    expectedBuf = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

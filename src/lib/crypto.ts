import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

// Everything secret hangs off APP_SECRET: session cookies are signed with it
// and calendar credentials are encrypted with it before they reach the database.

function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'APP_SECRET is not set (or is shorter than 32 characters). Generate one with: openssl rand -base64 32',
    );
  }
  return secret;
}

function derive(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret(), 'calendi', purpose, 32));
}

/** AES-256-GCM. Output: "v1." + base64url(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive('encrypt'), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function decrypt(token: string): string {
  if (!token.startsWith('v1.')) throw new Error('Unrecognised encrypted value');
  const raw = Buffer.from(token.slice(3), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', derive('encrypt'), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(token: string): T {
  return JSON.parse(decrypt(token)) as T;
}

export function sign(data: string): string {
  return createHmac('sha256', derive('sign')).update(data).digest('base64url');
}

export function verifySignature(data: string, signature: string): boolean {
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** HMAC with a caller-supplied key (used to sign outgoing webhooks). */
export function hmacHex(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Compares two secrets without leaking, through timing, how much of a guess
 * was right. Both sides are hashed first so their lengths do not matter.
 */
export function secretsMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const given = await scryptAsync(password, Buffer.from(salt, 'base64url'));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

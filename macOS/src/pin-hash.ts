/**
 * The app-lock PIN, hashed. No keychain, deliberately.
 *
 * The old format encrypted the hash with Electron safeStorage, which is the
 * macOS login keychain. That put a system panel in front of the lock screen on
 * every fresh install and every update ("OpenMemo wants to use your
 * confidential information stored in OpenMemo Safe Storage"), because an
 * ad-hoc signature changes with every build and the keychain treats each build
 * as a different app. An app that asks for keychain access to check its own
 * 4-digit PIN reads as an app going through your passwords. It never was, and
 * now it cannot be: nothing here imports safeStorage.
 *
 * What replaces it is scrypt over a random salt. What lands on disk is a hash,
 * the same as before, and the work factor is what makes the 10,000 possible
 * PINs cost something to grind: roughly 100ms per guess, so about a quarter of
 * an hour for the whole space. A plain SHA-256 hash falls in milliseconds,
 * which is why the old format wanted the keychain wrapper in the first place.
 *
 * This is a casual privacy lock. The library it sits in front of is not
 * encrypted, so anyone who can read this file can read the memos directly and
 * has no reason to attack the PIN at all.
 */
import crypto from 'node:crypto';

/** scrypt cost. N=32768 lands near 100ms on an M-series Mac. */
const KDF = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const;

interface PinRecord {
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
}

/** The verdict, plus a rewritten blob when the stored one is an old format. */
export interface PinVerdict {
  ok: boolean;
  /** Non-null when the caller should persist this in place of what it had. */
  upgraded: string | null;
}

function scryptHex(pin: string, salt: string, N: number, r: number, p: number): string {
  // maxmem must be raised by hand: node's default (32MB) rejects N=32768,r=8.
  return crypto
    .scryptSync(pin, salt, KDF.keylen, { N, r, p, maxmem: 256 * 1024 * 1024 })
    .toString('hex');
}

function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** A blob written by a build that stored the PIN in the keychain. */
export function isKeychainBlob(blob: string | undefined): boolean {
  return typeof blob === 'string' && blob.startsWith('v1:');
}

/** Hash a PIN into the blob that goes in the settings file. */
export function makePinBlob(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const rec: PinRecord = {
    salt,
    hash: scryptHex(pin, salt, KDF.N, KDF.r, KDF.p),
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
  };
  return 'v2:' + Buffer.from(JSON.stringify(rec), 'utf-8').toString('base64');
}

/**
 * Check a PIN against a stored blob.
 *
 * `v2:` is the scrypt format above. `raw:` is the pre-keychain fallback some
 * installs carry, a salted SHA-256; it verifies, and comes back with an
 * `upgraded` blob so the caller can leave scrypt behind it. `v1:` is the
 * keychain format and always fails here, because reading it would need the
 * keychain: those installs are migrated at startup instead, not verified.
 */
export function verifyPinBlob(blob: string | undefined, pin: string): PinVerdict {
  const no: PinVerdict = { ok: false, upgraded: null };
  if (!blob) return no;
  try {
    if (blob.startsWith('v2:')) {
      const rec = JSON.parse(Buffer.from(blob.slice(3), 'base64').toString('utf-8')) as PinRecord;
      if (!rec?.salt || !rec?.hash) return no;
      const got = scryptHex(pin, rec.salt, rec.N || KDF.N, rec.r || KDF.r, rec.p || KDF.p);
      return { ok: sameHash(got, rec.hash), upgraded: null };
    }
    if (blob.startsWith('raw:')) {
      const rec = JSON.parse(Buffer.from(blob.slice(4), 'base64').toString('utf-8')) as {
        salt: string;
        hash: string;
      };
      if (!rec?.salt || !rec?.hash) return no;
      const got = crypto.createHash('sha256').update(`${rec.salt}:${pin}`).digest('hex');
      if (!sameHash(got, rec.hash)) return no;
      return { ok: true, upgraded: makePinBlob(pin) };
    }
  } catch {
    /* corrupt blob: treat as a failed attempt, never as an unlock */
  }
  return no;
}

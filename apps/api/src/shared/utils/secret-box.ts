import crypto from 'crypto';
import { config } from '../../config';
import { ServiceUnavailableError } from '../errors';

/**
 * Encrypts secrets stored in the database (e.g. a client's SMTP password) with AES-256-GCM.
 * The key is derived from ENCRYPTION_KEY, so rotating that env var makes existing values unreadable.
 * Format: v1:<iv>:<auth tag>:<ciphertext>, each base64.
 */

function key(): Buffer {
  if (!config.ENCRYPTION_KEY) {
    throw new ServiceUnavailableError('ENCRYPTION_KEY is not set on the server, so secrets cannot be stored');
  }
  return crypto.createHash('sha256').update(config.ENCRYPTION_KEY).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

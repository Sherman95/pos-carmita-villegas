import { createHash, randomBytes } from 'node:crypto';

export const EMAIL_MAX_LENGTH = 160;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length > 3 && email.length <= EMAIL_MAX_LENGTH && /^\S+@\S+\.\S+$/.test(email);
}

export function normalizeWhatsapp(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s().-]/g, '');
  if (/^09\d{8}$/.test(compact)) return `+593${compact.slice(1)}`;
  if (/^5939\d{8}$/.test(compact)) return `+${compact}`;
  if (/^\+5939\d{8}$/.test(compact)) return compact;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

export function whatsappDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function legacyWhatsappCandidates(value: unknown): string[] {
  const normalized = normalizeWhatsapp(value);
  if (!normalized) return [];
  const digits = whatsappDigits(normalized);
  const candidates = new Set([digits]);
  if (digits.startsWith('5939')) candidates.add(`0${digits.slice(3)}`);
  return [...candidates];
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

export function createOpaqueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isOpaqueToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token);
}

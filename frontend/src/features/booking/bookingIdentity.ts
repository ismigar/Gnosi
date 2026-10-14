import type { BookingReservationInput } from '../../shared/api/booking';
import { defineStorageKey, jsonStorageCodec, readStorage, removeStorage, writeStorage } from '../../shared/platform/browser-storage';

export interface PendingBooking { date: string; request: BookingReservationInput }

export function bookingIdentity(): string {
  // Self-hosted HTTP origins have getRandomValues even without randomUUID.
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isPending(value: unknown): value is PendingBooking {
  if (!value || typeof value !== 'object' || !('date' in value) || !('request' in value)) return false;
  const request = value.request;
  return typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value.date)
    && !!request && typeof request === 'object'
    && 'start' in request && typeof request.start === 'string' && Number.isFinite(Date.parse(request.start))
    && 'name' in request && typeof request.name === 'string'
    && 'email' in request && typeof request.email === 'string'
    && 'idempotency_key' in request && typeof request.idempotency_key === 'string' && /^[a-zA-Z0-9_-]{16,128}$/u.test(request.idempotency_key);
}

function key(token: string) { return defineStorageKey(`gnosi:public-booking:${token}`, jsonStorageCodec(isPending), 'session'); }
export function readPendingBooking(token: string): PendingBooking | null { return readStorage(key(token)) ?? null; }
export function savePendingBooking(token: string, pending: PendingBooking): void { writeStorage(key(token), pending); }
export function clearPendingBooking(token: string): void { removeStorage(key(token)); }

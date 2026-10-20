import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { publicApiClient } from './public-client';
import { unwrapApiResult } from './errors';

export type BookingCalendar = components['schemas']['BookingCalendar'];
export type BookingSchedule = components['schemas']['BookingSchedule'];
export type BookingLink = components['schemas']['BookingLinkResponse'];
export type BookingLinkInput = components['schemas']['BookingLinkCreate'];
export type BookingSlots = components['schemas']['BookingSlotsResponse'];
export type BookingInfo = components['schemas']['BookingPublicInfo'];
export type BookingReservation = components['schemas']['BookingReservationResponse'];
export type BookingReservationInput = components['schemas']['BookingReservationRequest'];

export async function fetchBookingAvailability(date: string, schedule: BookingSchedule): Promise<BookingSlots> {
  return unwrapApiResult(await apiClient.POST('/api/booking/availability', { body: { date, schedule } }));
}

export async function fetchBookingLinks(signal?: AbortSignal): Promise<BookingLink[]> {
  return unwrapApiResult(await apiClient.GET('/api/booking/links', { signal }));
}

export async function createBookingLink(input: BookingLinkInput): Promise<BookingLink> {
  return unwrapApiResult(await apiClient.POST('/api/booking/links', { body: input }));
}

export async function revokeBookingLink(linkId: string): Promise<void> {
  unwrapApiResult(await apiClient.DELETE('/api/booking/links/{link_id}', { params: { path: { link_id: linkId } } }));
}

export async function fetchBookingInfo(token: string, signal?: AbortSignal): Promise<BookingInfo> {
  return unwrapApiResult(await publicApiClient.GET('/api/booking/public/{token}', { params: { path: { token } }, signal }));
}

export async function fetchBookingSlots(token: string, date: string, signal?: AbortSignal): Promise<BookingSlots> {
  return unwrapApiResult(await publicApiClient.GET('/api/booking/public/{token}/slots', { params: { path: { token }, query: { date } }, signal }));
}

export async function submitBooking(token: string, input: BookingReservationInput): Promise<BookingReservation> {
  return unwrapApiResult(await publicApiClient.POST('/api/booking/public/{token}/reservations', { params: { path: { token } }, body: input }));
}

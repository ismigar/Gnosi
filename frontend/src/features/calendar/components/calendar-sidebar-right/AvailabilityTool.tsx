import BookingManager from '../../../booking/BookingManager';
import type { CalendarConfig } from './calendarTypes';

export const AvailabilityTool = ({ calendars }: { calendars: readonly CalendarConfig[] }) => (
  <BookingManager calendars={calendars} />
);

// Booking lead time — movers need at least 3 days to plan/dispatch.
export const MIN_LEAD_DAYS = 3;

export interface CalendarDay {
  iso: string;          // YYYY-MM-DD
  weekday: string;      // Mon, Tue, etc.
  day: number;          // day of month
  month: string;        // Jan, Feb, etc.
  isLeadTime: boolean;  // true → not selectable
  isToday: boolean;
}

/** Build N days starting from today, marking the first `leadDays` as not bookable. */
export function buildCalendar(totalDays = 21, leadDays = MIN_LEAD_DAYS): CalendarDay[] {
  const days: CalendarDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      iso: d.toISOString().split('T')[0],
      weekday: d.toLocaleDateString('en-CA', { weekday: 'short' }),
      day: d.getDate(),
      month: d.toLocaleDateString('en-CA', { month: 'short' }),
      isLeadTime: i < leadDays,
      isToday: i === 0,
    });
  }
  return days;
}

export const firstBookableDay = (days: CalendarDay[]) => days.find((d) => !d.isLeadTime) ?? days[0];

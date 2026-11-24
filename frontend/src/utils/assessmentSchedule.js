import { isCalendarDate } from "../../../shared/inputValidation.mjs";
import { ASSESSMENT_STATUS } from "../../../shared/assessmentStatus.mjs";

export const SCHEDULE_REMINDER_DISMISSED = "eduliteScheduleReminderDismissed";
export const ASSESSMENT_STATUS_LABELS = Object.freeze({
  [ASSESSMENT_STATUS.NOT_CONDUCTED]: "Not yet conducted",
  [ASSESSMENT_STATUS.SCHEDULED]: "Scheduled",
  [ASSESSMENT_STATUS.DONE]: "Done",
  today: "Today",
});

export function assessmentStatusIndicator(status, isToday) {
  return status === ASSESSMENT_STATUS.SCHEDULED && isToday ? "today" : status ?? ASSESSMENT_STATUS.NOT_CONDUCTED;
}

export function todayAsInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const scheduleFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

export function formatScheduledDate(date) {
  if (!isCalendarDate(date)) return "Date unavailable";
  return scheduleFormatter.format(new Date(date));
}

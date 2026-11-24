import { useState } from "react";
import axios from "axios";
import { ASSESSMENT_STATUS } from "../../../shared/assessmentStatus.mjs";
import { API_URL, schoolYearRequest } from "../utils/api.js";
import { assessmentStatusIndicator, ASSESSMENT_STATUS_LABELS as STATUS_LABELS, todayAsInputValue } from "../utils/assessmentSchedule.js";
import "./assessmentStatus.css";

export function AssessmentStatusBadge({ status, date }) {
  const indicator = assessmentStatusIndicator(status, date === todayAsInputValue());
  return <span className="assessment-status-badge" data-assessment-indicator={indicator}>
    <span className="assessment-status-dot" aria-hidden="true" />
    <span className="assessment-status-label">{STATUS_LABELS[indicator]}</span>
  </span>;
}

export function AssessmentStatusSelect({ id, label, status, date, onChange, disabled, compact = false }) {
  const value = status ?? ASSESSMENT_STATUS.NOT_CONDUCTED;
  const isToday = date === todayAsInputValue();
  const indicator = assessmentStatusIndicator(value, isToday);
  return <div className={compact ? "assessment-status-badge assessment-status-quick" : "assessment-status-field"} data-assessment-indicator={indicator}>
    <span className={compact ? "assessment-status-dot" : "assessment-status-marker"} aria-hidden="true" />
    {compact && <span className="assessment-status-label" aria-hidden="true">{STATUS_LABELS[indicator]}</span>}
    <select id={id} aria-label={label} title={compact ? `${STATUS_LABELS[indicator]} · Change status` : undefined}
      value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
      className={compact ? "assessment-status-quick-select !min-h-0" : "assessment-status-select w-full rounded-[12px] border py-2 pr-2 disabled:opacity-60"}>
      <option value={ASSESSMENT_STATUS.NOT_CONDUCTED}>{STATUS_LABELS[ASSESSMENT_STATUS.NOT_CONDUCTED]}</option>
      <option value={ASSESSMENT_STATUS.SCHEDULED}>{STATUS_LABELS[assessmentStatusIndicator(ASSESSMENT_STATUS.SCHEDULED, isToday)]}</option>
      <option value={ASSESSMENT_STATUS.DONE}>{STATUS_LABELS[ASSESSMENT_STATUS.DONE]}</option>
    </select>
  </div>;
}

export default function AssessmentStatusControl({ assessment, year, onSaved }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");

  async function changeStatus(status) {
    setPending(status);
    setError("");
    try {
      const { data } = await axios.patch(
        `${API_URL}/assessments/${assessment.id}/status`, { status }, schoolYearRequest(year),
      );
      onSaved(assessment.id, data.status);
    } catch (error) {
      setError(error.response?.data?.message || "Unable to update assessment status.");
    } finally {
      setPending(null);
    }
  }

  return <div aria-busy={pending !== null}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <AssessmentStatusSelect compact label={`Status for ${assessment.name}`} status={pending ?? assessment.status}
        date={assessment.date} onChange={changeStatus} disabled={pending !== null} />
      <span className="min-w-0 break-words font-semibold">{assessment.name}</span>
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-[var(--ed-danger)]">{error}</p>}
  </div>;
}

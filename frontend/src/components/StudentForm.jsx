import { useEffect, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import axios from "axios";
import ValidatedInput from "./ValidatedInput";
import { parseWholeNumber, validateInput } from "../../../shared/inputValidation.mjs";

const API_URL = "http://localhost:3000";

const APPLE_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

const SUFFIXES = new Set(["Jr.", "Sr.", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]);

const EMPTY_FORM = {
  firstName: "",
  middleName: "",
  surname: "",
  suffix: "",
  grade: "",
  section: "",
  subject_ids: [],
};

function splitStoredName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  let suffix = "";

  if (parts.length && SUFFIXES.has(parts[parts.length - 1])) {
    suffix = parts.pop();
  }

  return {
    firstName: parts.shift() || "",

    surname: parts.pop() || "",

    middleName: parts.join(" "),

    suffix,
  };
}

export default function StudentForm({
  embedded = false,
  studentId = null,
  onCancel,
  onSaved,
} = {}) {
  const [formData, setFormData] = useState(EMPTY_FORM);

  const [sections, setSections] = useState([]);

  const [subjects, setSubjects] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();
  const params = useParams();

  const resolvedStudentId = studentId ?? params.id ?? null;

  const isEditing = Boolean(resolvedStudentId);

  useEffect(() => {
    const token = localStorage.getItem("eduliteToken");

    const storedUser = localStorage.getItem("user");

    if (!token || !storedUser) {
      navigate("/");
      return;
    }

    let cancelled = false;

    const loadForm = async () => {
      setLoading(true);
      setError("");
      setFormData(EMPTY_FORM);

      try {
        const requests = [
          axios.get(`${API_URL}/sections`),

          axios.get(`${API_URL}/subjects`),
        ];

        if (resolvedStudentId) {
          requests.push(axios.get(`${API_URL}/students/${resolvedStudentId}`));
        }

        const [sectionResponse, subjectResponse, studentResponse] =
          await Promise.all(requests);

        if (cancelled) {
          return;
        }

        const loadedSections = sectionResponse.data ?? [];

        const loadedSubjects = subjectResponse.data ?? [];

        setSections(loadedSections);

        setSubjects(loadedSubjects);

        if (studentResponse) {
          setFormData({
            ...splitStoredName(studentResponse.data.name),

            grade: String(studentResponse.data.grade ?? ""),

            section: studentResponse.data.section ?? "",

            subject_ids: studentResponse.data.subject_ids ?? [],
          });
        } else {
          setFormData({
            ...EMPTY_FORM,

            section: loadedSections[0]?.name ?? "",

            subject_ids: loadedSubjects[0]?.id
              ? [String(loadedSubjects[0].id)]
              : [],
          });
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError.response?.data?.message ||
              "Unable to load the student form.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadForm();

    return () => {
      cancelled = true;
    };
  }, [resolvedStudentId, navigate]);

  const updateField = (field, value) => {
    setFormData((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const toggleSubject = (subjectId) => {
    const normalizedId = String(subjectId);

    setFormData((current) => {
      const normalizedIds = current.subject_ids.map(String);

      const selected = normalizedIds.includes(normalizedId);

      return {
        ...current,

        subject_ids: selected
          ? normalizedIds.filter((idValue) => idValue !== normalizedId)
          : [...normalizedIds, normalizedId],
      };
    });
  };

  const closeForm = () => {
    if (saving) {
      return;
    }

    if (typeof onCancel === "function") {
      onCancel();
      return;
    }

    navigate("/dashboard");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (formData.subject_ids.length === 0) {
      setError("Select at least one subject for the student.");

      return;
    }

    for (const [field, label, required] of [["firstName", "First Name", true], ["middleName", "Middle Name", false], ["surname", "Surname", true]]) {
      const fieldError = validateInput(formData[field], { kind: "personName", label, required, maxLength: 100 });
      if (fieldError) { setError(fieldError); return; }
    }
    if (formData.suffix && !SUFFIXES.has(formData.suffix)) {
      setError("Select a valid name suffix.");
      return;
    }
    const grade = parseWholeNumber(formData.grade);

    if (!Number.isInteger(grade) || grade <= 0) {
      setError("Grade must be a positive whole number.");

      return;
    }

    if (!formData.section.trim()) {
      setError("Select a section for the student.");

      return;
    }

    const combinedName = [
      formData.firstName.trim(),
      formData.middleName.trim(),
      formData.surname.trim(),
      formData.suffix.trim(),
    ]
      .filter(Boolean)
      .join(" ");

    const nameError = validateInput(combinedName, { kind: "personName", label: "Student name" });
    if (nameError) {
      setError(nameError);

      return;
    }

    const payload = {
      name: combinedName,
      grade,

      section: formData.section.trim(),

      subject_ids: formData.subject_ids.map(String),
    };

    setSaving(true);

    try {
      const response = isEditing
        ? await axios.put(`${API_URL}/students/${resolvedStudentId}`, payload)
        : await axios.post(`${API_URL}/students`, payload);

      if (typeof onSaved === "function") {
        await onSaved(response.data, {
          isEditing,

          studentId: resolvedStudentId,
        });
      } else {
        navigate("/dashboard");
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message || "Unable to save the student.",
      );
    } finally {
      setSaving(false);
    }
  };

  const formCard = (
    <section
      aria-labelledby="student-form-title"
      className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]"
    >
      <div className="border-b border-[var(--ed-color-eef2f5)] px-6 py-6 sm:px-8 sm:py-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
          Student Details
        </p>
        <h2
          id="student-form-title"
          className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-[var(--ed-primary)]"
        >
          {isEditing ? "Edit Student" : "Register Student"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ed-color-71808d)]">
          Enter the learner's identity and academic enrollment. Only fields used
          by EduLITE are shown.
        </p>
      </div>

      <div className="p-6 sm:p-8">
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-[16px] border border-[var(--ed-color-f6cccc)] bg-[var(--ed-color-fff3f3)] p-4 text-sm text-[var(--ed-color-c53939)]"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-[18px] bg-[var(--ed-color-f7f9fb)] py-16 text-center text-sm text-[var(--ed-color-8a98a5)]"
          >
            Loading student form...
          </div>
        ) : (
          <form onSubmit={handleSubmit} aria-busy={saving} className="space-y-8">
            <section>
              <div className="mb-5">
                <h3 className="text-xl font-bold text-[var(--ed-color-25313c)]">Identity</h3>
                <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">
                  Enter the student's complete name.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField
                  id="student-first-name"
                  label="First Name"
                  value={formData.firstName}
                  onChange={(value) => updateField("firstName", value)}
                  required
                  placeholder="e.g. Juan"
                  autoComplete="given-name"
                />

                <TextField
                  id="student-middle-name"
                  label="Middle Name"
                  value={formData.middleName}
                  onChange={(value) => updateField("middleName", value)}
                  placeholder="Optional"
                  autoComplete="additional-name"
                />

                <TextField
                  id="student-surname"
                  label="Surname"
                  value={formData.surname}
                  onChange={(value) => updateField("surname", value)}
                  required
                  placeholder="e.g. Dela Cruz"
                  autoComplete="family-name"
                />

                <div>
                  <FormLabel htmlFor="student-suffix" label="Suffix" />
                  <select id="student-suffix" value={formData.suffix} onChange={(event) => updateField("suffix", event.target.value)} className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]">
                    <option value="">None</option>
                    {[...SUFFIXES].map((suffix) => <option key={suffix} value={suffix}>{suffix}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <div className="h-px bg-[var(--ed-color-eef2f5)]" />

            <section>
              <div className="mb-5">
                <h3 className="text-xl font-bold text-[var(--ed-color-25313c)]">
                  Academic Information
                </h3>
                <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">
                  Assign the student's grade, section, and enrolled subjects.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FormLabel htmlFor="student-grade" label="Grade" required />
                  <ValidatedInput
                    id="student-grade"
                    kind="integer"
                    label="Grade"
                    min={1}
                    value={formData.grade}
                    onChange={(event) => updateField("grade", event.target.value)}
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  />
                </div>

                <div>
                  <FormLabel htmlFor="student-section" label="Section" required />
                  <select
                    id="student-section"
                    value={formData.section}
                    onChange={(event) => updateField("section", event.target.value)}
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  >
                    <option value="">Select a section</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.name}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <fieldset className="mt-6">
                <legend className="mb-3 text-sm font-semibold text-[var(--ed-color-52616d)]">
                  Subjects <span className="text-[var(--ed-color-d94141)]">*</span>
                </legend>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {subjects.map((subject) => {
                    const subjectId = String(subject.id);
                    const selected = formData.subject_ids.map(String).includes(subjectId);

                    return (
                      <label
                        key={subjectId}
                        className={`flex cursor-pointer items-center gap-3 rounded-[13px] border px-4 py-3 transition ${
                          selected
                            ? "border-[var(--ed-color-a9ddf3)] bg-[var(--ed-color-eaf6fc)] text-[var(--ed-color-168cc8)]"
                            : "border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] text-[var(--ed-color-52616d)] hover:bg-[var(--ed-color-f8fafb)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleSubject(subjectId)}
                          className="h-4 w-4 accent-[var(--ed-primary)]"
                        />
                        <span className="font-medium">{subject.name}</span>
                      </label>
                    );
                  })}
                </div>

                {subjects.length === 0 && (
                  <p className="rounded-[14px] bg-[var(--ed-color-fff8e6)] p-4 text-sm text-[var(--ed-color-8a6a12)]">
                    No subjects exist yet. Add a subject from the dashboard first.
                  </p>
                )}
              </fieldset>
            </section>

            <div className="flex flex-col gap-2 border-t border-[var(--ed-color-eef2f5)] pt-6 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-5 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)] hover:bg-[var(--ed-color-f4f7fa)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || sections.length === 0 || subjects.length === 0}
                className="rounded-[12px] bg-[var(--ed-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:bg-[var(--ed-color-c8d1d8)]"
              >
                {saving ? "Saving..." : isEditing ? "Update Student" : "Save Student"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );

  if (embedded) {
    return formCard;
  }

  return (
    <div
      className="min-h-screen bg-[var(--ed-color-f4f7fa)] p-4 text-[var(--ed-color-25313c)] sm:p-8"
      style={{ fontFamily: APPLE_FONT }}
    >
      <div className="mx-auto max-w-5xl">{formCard}</div>
    </div>
  );
}

function FormLabel({ htmlFor, label, required = false }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-[var(--ed-color-52616d)]">
      {label} {required && <span className="text-[var(--ed-color-d94141)]">*</span>}
    </label>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  required = false,
  placeholder = "",
  autoComplete,
}) {
  return (
    <div>
      <FormLabel htmlFor={id} label={label} required={required} />
      <ValidatedInput
        id={id}
        kind="personName"
        label={label}
        maxLength={100}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] placeholder-[var(--ed-color-a0abb4)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
        required={required}
      />
    </div>
  );
}

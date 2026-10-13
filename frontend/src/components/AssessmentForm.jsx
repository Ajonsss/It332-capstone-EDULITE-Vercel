import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import ValidatedInput from "./ValidatedInput";
import { parseWholeNumber, validateInput } from "../../../shared/inputValidation.mjs";

const API_URL = "http://localhost:3000";

const APPLE_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

const TERM_OPTIONS = [1, 2, 3];

const CATEGORY_OPTIONS = [
  {
    value: "written_work",
    label: "Written / Oral Works",
    shortLabel: "WW",
    maxSequence: 5,
    weightLabel: "20% of Initial Grade",
  },
  {
    value: "performance_task",
    label: "Product / Performance Tasks",
    shortLabel: "PT",
    maxSequence: 3,
    weightLabel: "50% of Initial Grade",
  },
  {
    value: "summative_test",
    label: "Summative Test",
    shortLabel: "ST",
    maxSequence: 2,
    weightLabel: "Part of the 30% Summative/Exam component",
  },
  {
    value: "term_exam",
    label: "Term Examination",
    shortLabel: "TE",
    maxSequence: 1,
    weightLabel: "40% inside the 30% Summative/Exam component",
  },
];

function todayAsInputValue() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - timezoneOffset)
    .toISOString()
    .slice(0, 10);
}

function emptyAssessmentForm() {
  return {
    name: "",
    budget_of_work: "",
    term: "1",
    category: "written_work",
    sequence: "1",
    date: todayAsInputValue(),
    total_items: "",
    subject_id: "",
  };
}

function getCategoryOption(category) {
  return CATEGORY_OPTIONS.find(
    (option) => option.value === category,
  );
}

function getSlotLabel(category, sequence) {
  const option = getCategoryOption(category);
  const numericSequence = Number(sequence);

  if (!option || !Number.isInteger(numericSequence)) {
    return "Unassigned";
  }

  if (category === "term_exam") {
    return "Term Exam";
  }

  return `${option.shortLabel}${numericSequence}`;
}

export default function AssessmentForm({
  embedded = false,
  assessmentId = null,
  onCancel,
  onSaved,
} = {}) {
  const [formData, setFormData] = useState(emptyAssessmentForm);
  const [gradingRules, setGradingRules] = useState({ writtenWorkWeight: 20, performanceTaskWeight: 50, examinationWeight: 30 });
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const params = useParams();

  const resolvedAssessmentId = assessmentId ?? params.id ?? null;
  const isEditing = Boolean(resolvedAssessmentId);

  const selectedCategory = useMemo(
    () => getCategoryOption(formData.category),
    [formData.category],
  );

  const sequenceOptions = useMemo(() => {
    const maximum = selectedCategory?.maxSequence ?? 0;

    return Array.from(
      { length: maximum },
      (_, index) => index + 1,
    );
  }, [selectedCategory]);

  const loadStudentsForSubject = async (
    subjectId,
    preserveScores = false,
  ) => {
    if (!subjectId) {
      setStudents([]);
      setScores({});
      return;
    }

    setLoadingStudents(true);
    setError("");

    try {
      const response = await axios.get(`${API_URL}/students`, {
        params: {
          subject_id: String(subjectId),
        },
      });

      const loadedStudents = response.data ?? [];

      setStudents(loadedStudents);

      setScores((currentScores) =>
        Object.fromEntries(
          loadedStudents.map((student) => [
            student.id,
            preserveScores
              ? (currentScores[student.id] ?? "")
              : "",
          ]),
        ),
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to load students for the subject.",
      );
    } finally {
      setLoadingStudents(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem("eduliteToken");
    const storedUser = localStorage.getItem("user");

    if (!token || !storedUser) {
      navigate("/");
      return;
    }

    let cancelled = false;

    const loadPage = async () => {
      setLoading(true);
      setError("");
      setFormData(emptyAssessmentForm());
      setStudents([]);
      setScores({});

      try {
        const [subjectResponse, ruleResponse] = await Promise.all([axios.get(`${API_URL}/subjects`), axios.get(`${API_URL}/grading-rules`)]);
        if (!cancelled) setGradingRules(ruleResponse.data);

        if (cancelled) {
          return;
        }

        const loadedSubjects = subjectResponse.data ?? [];
        setSubjects(loadedSubjects);

        if (isEditing) {
          const assessmentResponse = await axios.get(
            `${API_URL}/assessments/${resolvedAssessmentId}`,
          );

          if (cancelled) {
            return;
          }

          const assessment = assessmentResponse.data;
          const assessmentStudents = assessment.students ?? [];

          setFormData({
            name: assessment.name ?? "",
            budget_of_work: assessment.budget_of_work ?? "",

            // Legacy assessments intentionally stay blank until the
            // teacher explicitly classifies them into the new ECR system.
            term:
              assessment.term === null ||
              assessment.term === undefined
                ? ""
                : String(assessment.term),

            category: assessment.category ?? "",

            sequence:
              assessment.sequence === null ||
              assessment.sequence === undefined
                ? ""
                : String(assessment.sequence),

            date:
              assessment.date ?? todayAsInputValue(),

            total_items: String(
              assessment.total_items ?? "",
            ),

            subject_id: String(
              assessment.subject_id ?? "",
            ),
          });

          setStudents(assessmentStudents);

          setScores(
            Object.fromEntries(
              assessmentStudents.map((student) => [
                student.id,
                student.score ?? "",
              ]),
            ),
          );
        } else {
          const firstSubjectId = loadedSubjects[0]?.id;

          setFormData((current) => ({
            ...current,
            subject_id: firstSubjectId
              ? String(firstSubjectId)
              : "",
          }));

          if (firstSubjectId) {
            await loadStudentsForSubject(
              String(firstSubjectId),
            );
          }
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError.response?.data?.message ||
              "Unable to load the assessment form.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPage();

    return () => {
      cancelled = true;
    };
  }, [resolvedAssessmentId, isEditing, navigate]);

  const handleSubjectChange = async (value) => {
    setFormData((current) => ({
      ...current,
      subject_id: value,
    }));

    await loadStudentsForSubject(value);
  };

  const handleCategoryChange = (value) => {
    setFormData((current) => ({
      ...current,
      category: value,
      sequence: "1",
    }));
  };

  const totalItems = parseWholeNumber(formData.total_items);

  const enteredCount = useMemo(
    () =>
      Object.values(scores).filter(
        (score) => score !== "",
      ).length,
    [scores],
  );

  const handleScoreChange = (studentId, value) => {
    if (value !== "" && !/^\d+$/.test(value)) {
      return;
    }

    setScores((current) => ({
      ...current,
      [studentId]: value,
    }));
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

    const nameError = validateInput(formData.name, { kind: "assessment", label: "Assessment name" });
    if (nameError) {
      setError(nameError);
      return;
    }

    if (!formData.subject_id) {
      setError("Select a subject for the assessment.");
      return;
    }

    const term = parseWholeNumber(formData.term);

    if (![1, 2, 3].includes(term)) {
      setError("Select Term 1, Term 2, or Term 3.");
      return;
    }

    if (!selectedCategory) {
      setError("Select an ECR grading category.");
      return;
    }

    const sequence = parseWholeNumber(formData.sequence);

    if (
      !Number.isInteger(sequence) ||
      sequence < 1 ||
      sequence > selectedCategory.maxSequence
    ) {
      setError("Select a valid ECR assessment slot.");
      return;
    }

    if (!Number.isInteger(totalItems) || totalItems <= 0) {
      setError(
        "Highest Possible Score must be a positive whole number.",
      );
      return;
    }

    const budgetError = validateInput(formData.budget_of_work, { kind: "budgetOfWork", label: "Budget of Work" });
    if (budgetError) { setError(budgetError); return; }

    const dateError = validateInput(formData.date, { kind: "date", label: "Assessment date" });
    if (dateError) { setError(dateError); return; }

    for (const [studentId, value] of Object.entries(scores)) {
      if (value === "") {
        continue;
      }

      const score = parseWholeNumber(value);

      if (
        !Number.isInteger(score) ||
        score < 0 ||
        score > totalItems
      ) {
        const student = students.find(
          (item) =>
            String(item.id) === String(studentId),
        );

        setError(
          `${student?.name || "A student"}'s score must be from 0 to ${totalItems}.`,
        );
        return;
      }
    }

    const payload = {
      name: formData.name.trim(),
      budget_of_work: (formData.budget_of_work ?? "").trim(),
      term,
      category: formData.category,
      sequence,
      date: formData.date,
      total_items: totalItems,
      subject_id: String(formData.subject_id),

      scores: students.map((student) => ({
        student_id: String(student.id),
        score:
          scores[student.id] === "" ||
          scores[student.id] === undefined
            ? null
            : Number(scores[student.id]),
      })),
    };

    setSaving(true);

    try {
      const response = isEditing
        ? await axios.put(
            `${API_URL}/assessments/${resolvedAssessmentId}`,
            payload,
          )
        : await axios.post(
            `${API_URL}/assessments`,
            payload,
          );

      if (typeof onSaved === "function") {
        await onSaved(response.data, {
          isEditing,
          assessmentId: resolvedAssessmentId,
        });
      } else {
        navigate("/dashboard");
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Unable to save the assessment.",
      );
    } finally {
      setSaving(false);
    }
  };

  const formCard = (
    <section
      aria-labelledby="assessment-form-title"
      className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]"
    >
      <div className="border-b border-[var(--ed-color-eef2f5)] px-6 py-6 sm:px-8 sm:py-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
          Three-Term ECR
        </p>
        <h2
          id="assessment-form-title"
          className="mt-2 text-3xl font-extrabold tracking-[-0.03em] text-[var(--ed-primary)]"
        >
          {isEditing ? "Edit Assessment" : "Create Assessment"}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ed-color-71808d)]">
          Set the ECR position and Highest Possible Score, then enter learner raw scores.
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
            Loading assessment form...
          </div>
        ) : (
          <form onSubmit={handleSubmit} aria-busy={saving} className="space-y-8">
            <section>
              <div className="mb-5">
                <h3 className="text-xl font-bold text-[var(--ed-color-25313c)]">Assessment Details</h3>
                <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">
                  Choose the subject, term, component, and exact ECR slot.
                </p>
              </div>

              {isEditing && (!formData.term || !formData.category || !formData.sequence) && (
                <div className="mb-5 rounded-[14px] border border-[var(--ed-color-f1d58b)] bg-[var(--ed-color-fff9e8)] p-4 text-sm text-[var(--ed-color-8a6a12)]">
                  This legacy assessment must be assigned to a term and ECR slot before it can participate in official grades.
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <FormLabel htmlFor="assessment-name" label="Assessment Name" required />
                  <ValidatedInput
                    id="assessment-name"
                    kind="assessment"
                    label="Assessment name"
                    value={formData.name}
                    onChange={(event) =>
                      setFormData((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="e.g. Reading Comprehension Activity"
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] placeholder-[var(--ed-color-a0abb4)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <FormLabel htmlFor="assessment-budget-of-work" label="Budget of Work" required />
                  <textarea
                    id="assessment-budget-of-work"
                    value={formData.budget_of_work ?? ""}
                    onChange={(event) => setFormData((current) => ({ ...current, budget_of_work: event.target.value }))}
                    rows={5}
                    maxLength={5000}
                    required
                    aria-describedby="budget-of-work-help"
                    placeholder="Topics and learning competencies covered, learning objectives, lesson scope, and suggested time allocation."
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                  />
                  <p id="budget-of-work-help" className="mt-2 text-xs text-[var(--ed-color-71808d)]">Describe what this assessment covers. AI uses this to create practice activities for students who need support. Maximum 5,000 characters.</p>
                </div>

                <div>
                  <FormLabel htmlFor="assessment-subject" label="Subject" required />
                  <select
                    id="assessment-subject"
                    value={formData.subject_id}
                    onChange={(event) => handleSubjectChange(event.target.value)}
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  >
                    <option value="">Select a subject</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>{subject.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <FormLabel htmlFor="assessment-term" label="Grading Term" required />
                  <select
                    id="assessment-term"
                    value={formData.term}
                    onChange={(event) =>
                      setFormData((current) => ({ ...current, term: event.target.value }))
                    }
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  >
                    <option value="">Select a term</option>
                    {TERM_OPTIONS.map((term) => (
                      <option key={term} value={term}>Term {term}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <FormLabel htmlFor="assessment-category" label="ECR Component" required />
                  <select
                    id="assessment-category"
                    value={formData.category}
                    onChange={(event) => handleCategoryChange(event.target.value)}
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  >
                    <option value="">Select a component</option>
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  {selectedCategory && (
                    <p className="mt-2 text-xs text-[var(--ed-color-8a98a5)]">{formData.category === "written_work" ? `${gradingRules.writtenWorkWeight}% of Initial Grade` : formData.category === "performance_task" ? `${gradingRules.performanceTaskWeight}% of Initial Grade` : `Part of the ${gradingRules.examinationWeight}% Summative/Exam component`}</p>
                  )}
                </div>

                <div>
                  <FormLabel htmlFor="assessment-sequence" label="ECR Slot" required />
                  <select
                    id="assessment-sequence"
                    value={formData.sequence}
                    onChange={(event) =>
                      setFormData((current) => ({ ...current, sequence: event.target.value }))
                    }
                    disabled={!selectedCategory}
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10 disabled:bg-[var(--ed-color-f0f3f5)]"
                    required
                  >
                    <option value="">Select a slot</option>
                    {sequenceOptions.map((sequence) => (
                      <option key={sequence} value={sequence}>
                        {getSlotLabel(formData.category, sequence)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <FormLabel htmlFor="assessment-date" label="Date" required />
                  <ValidatedInput
                    id="assessment-date"
                    type="date"
                    kind="date"
                    label="Assessment date"
                    value={formData.date}
                    onChange={(event) =>
                      setFormData((current) => ({ ...current, date: event.target.value }))
                    }
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  />
                </div>

                <div>
                  <FormLabel htmlFor="assessment-total-items" label="Highest Possible Score (HPS)" required />
                  <ValidatedInput
                    id="assessment-total-items"
                    kind="integer"
                    label="Highest Possible Score"
                    min={1}
                    value={formData.total_items}
                    onChange={(event) =>
                      setFormData((current) => ({ ...current, total_items: event.target.value }))
                    }
                    placeholder="e.g. 50"
                    className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] placeholder-[var(--ed-color-a0abb4)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                    required
                  />
                </div>
              </div>

              <div className="mt-5 rounded-[14px] bg-[var(--ed-color-f4f7fa)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">
                  ECR Position
                </p>
                <p className="mt-1.5 font-semibold text-[var(--ed-color-25313c)]">
                  {formData.term ? `Term ${formData.term}` : "No term"}
                  {" · "}
                  {selectedCategory?.label ?? "No component"}
                  {" · "}
                  {getSlotLabel(formData.category, formData.sequence)}
                </p>
              </div>
            </section>

            <div className="h-px bg-[var(--ed-color-eef2f5)]" />

            <section>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-[var(--ed-color-25313c)]">Student Raw Scores</h3>
                  <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">
                    Leave a score blank when it has not been recorded yet. A value of 0 is a real score.
                  </p>
                </div>
                <span className="text-sm font-semibold text-[var(--ed-primary)]">
                  {enteredCount} of {students.length} entered
                </span>
              </div>

              {loadingStudents ? (
                <div className="mt-5 rounded-[16px] bg-[var(--ed-color-f7f9fb)] py-12 text-center text-sm text-[var(--ed-color-8a98a5)]">
                  Loading enrolled students...
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto rounded-[18px] border border-[var(--ed-color-e3e9ee)]">
                  <table className="w-full min-w-[650px]">
                    <thead className="bg-[var(--ed-color-f8fafb)]">
                      <tr className="border-b border-[var(--ed-color-e3e9ee)]">
                        <th className="px-5 py-3.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">Student</th>
                        <th className="px-5 py-3.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">Grade</th>
                        <th className="px-5 py-3.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">Section</th>
                        <th className="px-5 py-3.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">Raw Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
                      {students.map((student) => (
                        <tr key={student.id} className="hover:bg-[var(--ed-color-fbfcfd)]">
                          <td className="px-5 py-4 font-semibold text-[var(--ed-color-25313c)]">{student.name}</td>
                          <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">{student.grade}</td>
                          <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">{student.section}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-24">
                                <ValidatedInput
                                  aria-label={`Score for ${student.name}`}
                                  kind="integer"
                                  label={`Score for ${student.name}`}
                                  min={0}
                                  max={totalItems > 0 ? totalItems : Number.MAX_SAFE_INTEGER}
                                  value={scores[student.id] ?? ""}
                                  onChange={(event) => handleScoreChange(student.id, event.target.value)}
                                  className="w-24 rounded-[11px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2 text-center font-semibold text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)] focus:ring-4 focus:ring-[var(--ed-primary)]/10"
                                  placeholder="—"
                                />
                              </div>
                              <span className="text-xs text-[var(--ed-color-8a98a5)]">/ {totalItems > 0 ? totalItems : "?"}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {students.length === 0 && (
                        <tr>
                          <td colSpan="4" className="px-5 py-12 text-center text-sm text-[var(--ed-color-8a98a5)]">
                            No students are enrolled in this subject yet. The assessment can still be saved.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
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
                disabled={saving || subjects.length === 0}
                className="rounded-[12px] bg-[var(--ed-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:bg-[var(--ed-color-c8d1d8)]"
              >
                {saving ? "Saving..." : isEditing ? "Update Assessment" : "Save Assessment"}
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
    <div className="min-h-screen bg-[var(--ed-color-f4f7fa)] p-4 text-[var(--ed-color-25313c)] sm:p-8" style={{ fontFamily: APPLE_FONT }}>
      <div className="mx-auto max-w-6xl">{formCard}</div>
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

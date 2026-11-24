import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { TERM_NUMBERS, termLabel } from "../../../shared/academicTerms.mjs";
import { API_URL, schoolYearRequest } from "../utils/api.js";
import {
  ALL_ASSIGNMENTS, buildTeachingAssignments, indexAssessmentScores, indexGradeSummaries,
  listLearningSupport, selectTeachingAssignments, summarizeAssessments, summarizeAssignment,
  summarizeDistribution, summarizeOverview,
} from "../utils/dashboardAnalytics.js";
import { getPerformanceStatus, PERFORMANCE_LEVELS } from "../utils/performance.js";
import AssessmentStatusControl, { AssessmentStatusBadge } from "./AssessmentStatusControl";
import LoadingIndicator from "./LoadingIndicator";
import "./dashboardFolderTabs.css";

const AssessmentForm = lazy(() => import("./AssessmentForm"));
const LEGACY_YEAR = "legacy";
const ALL_LABELS = { grade: "All my grade levels", section: "All my sections", subject: "All my subjects" };
const PAGE_SIZE = 10;
const EMPTY_CLASSES = "No teaching assignments match this scope. Register a class or enroll students in a subject to see it here.";
const card = "min-w-0 rounded-[24px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-5 sm:p-7";
const muted = "text-sm leading-5 text-[var(--ed-muted)]";
const button = "rounded-xl border border-[var(--ed-border)] px-3 py-2 text-sm font-semibold text-[var(--ed-accent-text)] hover:bg-[var(--ed-subtle)] disabled:opacity-50";
const primaryButton = "rounded-xl bg-[var(--ed-primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:opacity-50";
const actionLink = "text-left text-sm font-semibold text-[var(--ed-accent-text)] hover:underline";
const metric = (value, suffix = "") => value === null ? "—" : `${value.toFixed(1)}${suffix}`;
const sectionLabel = (assignment) => `Section ${assignment.sectionName}`;
const assignmentLabel = (assignment) => `Grade ${assignment.grade} · ${sectionLabel(assignment)}`;
const yearValue = (id) => id == null ? LEGACY_YEAR : String(id);

export default function TeachingDashboard({
  activeData, onActiveReport, onAssessmentStatusChanged, onNotify, onOpenLibrary, onGenerate, generating, onLoadStudentInsights,
  renderStudentProfile, folderTabsHost, description,
}) {
  const [yearSelection, setYearSelection] = useState(null);
  const [term, setTerm] = useState(String(TERM_NUMBERS[0]));
  const [requested, setRequested] = useState(ALL_ASSIGNMENTS);
  const [yearReport, setYearReport] = useState(null);
  const [yearError, setYearError] = useState("");
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("dashboard");
  const [deletingId, setDeletingId] = useState(null);
  const request = useRef(null);
  const yearRevision = useRef(0);
  const detailSection = useRef(null);
  const filterSection = useRef(null);
  useEffect(() => () => {
    request.current?.abort();
    yearRevision.current += 1;
  }, []);
  useEffect(() => {
    if (detail) detailSection.current?.focus();
  }, [detail]);

  const activeYear = yearValue(activeData.schoolYears.activeId);
  const year = yearSelection ?? activeYear;
  const isActiveYear = year === activeYear;
  const data = yearSelection === null ? activeData : yearReport?.year === year ? yearReport.data : null;
  const years = activeData.schoolYears.years.map(({ _id, name }) => ({ value: yearValue(_id), label: name }));
  if (!years.some(({ value }) => value === LEGACY_YEAR)) years.push({ value: LEGACY_YEAR, label: "Legacy / unassigned records" });
  const yearLabel = years.find(({ value }) => value === year)?.label ?? "School year";

  const assignments = useMemo(() => data ? buildTeachingAssignments(data) : [], [data]);
  const unassignedCount = useMemo(() => {
    if (!data) return 0;
    const assigned = new Set(assignments.flatMap(({ students }) => students.map(({ id }) => id)));
    return data.students.filter(({ id }) => !assigned.has(id)).length;
  }, [assignments, data]);
  const scope = useMemo(() => selectTeachingAssignments(assignments, requested), [assignments, requested]);
  const { selection } = scope;
  const allClasses = Object.values(selection).every((value) => value === "ALL");
  const summaries = useMemo(() => indexGradeSummaries(data?.gradeSummaries ?? []), [data]);
  const scores = useMemo(() => indexAssessmentScores(data?.assessmentRecords ?? []), [data]);
  const rules = data?.gradingRules;
  const classes = useMemo(() => rules ? scope.assignments.map((item) =>
    summarizeAssignment(item, summaries, term, rules.passingGrade)) : [], [scope, summaries, term, rules]);
  const selectedClass = selection.section !== "ALL" && selection.subject !== "ALL" && classes.length === 1 ? classes[0] : null;
  const selectedSection = selection.section === "ALL" ? null : scope.assignments[0];
  const context = [
    selectedSection ? `Grade ${selectedSection.grade}` :
      scope.grades.find(({ value }) => value === selection.grade)?.label ?? ALL_LABELS.grade,
    selectedSection ? sectionLabel(selectedSection) : ALL_LABELS.section,
    scope.subjects.find(({ value }) => value === selection.subject)?.label ?? ALL_LABELS.subject,
    termLabel(term),
  ].join(" · ");
  const scopeKey = `${year}:${term}:${selection.grade}:${selection.section}:${selection.subject}`;

  async function loadYear(nextYear) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setYearError("");
    try {
      const { data: report } = await axios.get(`${API_URL}/dashboard`, {
        ...schoolYearRequest(nextYear), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const nextAssignments = buildTeachingAssignments(report);
      setYearSelection(nextYear);
      setYearReport({ year: nextYear, data: report });
      setRequested((previous) => selectTeachingAssignments(nextAssignments, previous).selection);
      if (nextYear === yearValue(report.schoolYears.activeId)) onActiveReport(report);
    } catch (error) {
      if (!controller.signal.aborted) setYearError(error.response?.data?.message || "Unable to load this school year.");
    }
  }

  function changeYear(nextYear) {
    yearRevision.current += 1;
    setYearSelection(nextYear);
    setYearReport(null);
    setSearch("");
    void loadYear(nextYear);
  }

  function changeScope(next) {
    setRequested(selectTeachingAssignments(assignments, next).selection);
    setSearch("");
  }

  function updateAssessmentStatus(id, status) {
    if (isActiveYear) onAssessmentStatusChanged(id, status);
    setYearReport((current) => current?.year === year ? {
      ...current,
      data: {
        ...current.data,
        assessments: current.data.assessments.map((assessment) => assessment.id === id ? { ...assessment, status } : assessment),
      },
    } : current);
  }

  async function removeAssessment(assessment) {
    if (deletingId || !window.confirm(`Delete "${assessment.name}" and all its recorded scores?`)) return;
    const revision = yearRevision.current;
    setDeletingId(assessment.id);
    try {
      await axios.delete(`${API_URL}/assessments/${assessment.id}`, schoolYearRequest(year));
      onNotify("success", "Assessment deleted successfully.");
      if (revision === yearRevision.current) await loadYear(year);
    } catch (error) {
      onNotify("error", error.response?.data?.message || "Unable to delete the assessment.");
    } finally {
      setDeletingId(null);
    }
  }

  const assessmentResults = useMemo(() => data ?
    summarizeAssessments(data.assessments, classes, scores, term) : [], [data, classes, scores, term]);
  const support = useMemo(() => rules ? listLearningSupport(classes, rules) : [], [classes, rules]);
  const openProfile = (student) => {
    setDetail({ kind: "student", student });
    void onLoadStudentInsights(student.id, false, year);
  };
  const openEditor = (assessmentId = null) => setDetail({ kind: "editor", assessmentId });
  function showAssignments(item) {
    changeScope({ grade: String(item.grade), section: item.sectionKey, subject: item.subjectId });
    setSelectedFolder("dashboard");
    filterSection.current?.focus();
  }

  return (
    <div className="dashboard-folder-panel space-y-6 p-5 sm:p-7">
      <section ref={filterSection} tabIndex={-1} aria-label="Dashboard filters" className="border-b border-[var(--ed-border)] pb-5">
        <p className={`mb-3 ${muted}`}>{description}</p>
        <p className="break-words font-semibold text-[var(--ed-text)]">{yearLabel}</p>
        <p className={`mt-1 break-words ${muted}`} aria-live="polite">{data ? context : termLabel(term)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <ReportSelect label="School Year" value={year} options={years} disabled={Boolean(detail)} onChange={changeYear} />
          <ReportSelect label="Term" value={term} options={TERM_NUMBERS.map((value) => ({ value: String(value), label: termLabel(value) }))}
            disabled={Boolean(detail)} onChange={setTerm} />
          {[[ "Grade Level", "grade", scope.grades ], [ "Section", "section", scope.sections ], [ "Subject", "subject", scope.subjects ]].map(([label, key, options]) => (
            <ReportSelect key={key} label={label} value={selection[key]} disabled={!data || Boolean(detail)}
              options={[{ value: "ALL", label: ALL_LABELS[key] }, ...options]} onChange={(value) => changeScope({ ...selection, [key]: value })} />
          ))}
        </div>
        <button type="button" className={`mt-3 ${actionLink} disabled:opacity-50`} disabled={!data || Boolean(detail) || allClasses}
          onClick={() => changeScope(ALL_ASSIGNMENTS)}>Reset class filters</button>
      </section>

      {yearError && <div className={card} role="alert"><p>{yearError}</p><button type="button" className={`mt-3 ${button}`} onClick={() => loadYear(year)}>Retry</button></div>}
      {!data && !yearError && <LoadingIndicator label="Loading school year…" />}

      {data && detail && (
        <section ref={detailSection} tabIndex={-1} className={card} aria-label="Dashboard details">
          {detail.kind !== "editor" && <button type="button" className={`mb-5 ${button}`} onClick={() => setDetail(null)}>Back to dashboard</button>}
          {detail.kind === "student" && renderStudentProfile({ student: detail.student, data, scores, year })}
          {detail.kind === "assessment" && (
            <AssessmentDetail row={detail.row} onEdit={() => openEditor(detail.row.assessment.id)} />
          )}
          {detail.kind === "editor" && (
            <Suspense fallback={<LoadingIndicator label="Loading assessment form…" />}>
              <AssessmentForm embedded assessmentId={detail.assessmentId} schoolYearId={year} dashboardData={data}
                initialTerm={term} initialSubjectId={selection.subject === "ALL" ? undefined : selection.subject}
                initialGrade={selectedClass?.grade} initialSectionId={selectedClass?.sectionId}
                onCancel={() => setDetail(null)}
                onSaved={async (_result, { isEditing }) => {
                  await loadYear(year);
                  setDetail(null);
                  onNotify("success", isEditing ? "Assessment updated successfully." : "Assessment added successfully.");
                }} />
            </Suspense>
          )}
        </section>
      )}

      {data && !detail && (
        <DashboardFolderTabs host={folderTabsHost} selected={selectedFolder} onSelect={setSelectedFolder}
          folders={[
            { id: "dashboard", label: "Dashboard", content: (
              <>
                <SummaryCards classes={classes} selectedClass={selectedClass} passingGrade={rules.passingGrade} />
                <div className={`space-y-2 ${muted}`}>
                  <p>
                    Subject-term results use EduLITE’s grading rules and component weights.
                    In-progress averages use the scored components available so far. Official and imported term grades are identified separately.
                  </p>
                  {unassignedCount > 0 && <p>
                    These summaries exclude {unassignedCount} enrollment{unassignedCount === 1 ? "" : "s"} with a missing section or subject assignment.
                  </p>}
                </div>
                {selectedClass && (
                  <div className="grid gap-6 xl:grid-cols-2">
                    <StudentDistribution assignment={selectedClass} term={term} />
                    <TermTrend assignment={selectedClass} summaries={summaries} passingGrade={rules.passingGrade} />
                  </div>
                )}
                <SubjectPerformance classes={classes} term={term} scopeKey={scopeKey} />
              </>
            ) },
            { id: "classes", label: "My Classes", content: (
              <MyClassCards classes={classes} term={term} summaries={summaries} passingGrade={rules.passingGrade} onSelect={showAssignments} />
            ) },
            { id: "students", label: "Student List", content: selectedClass
              ? <StudentList key={scopeKey} assignment={selectedClass} search={search} onSearch={setSearch} onProfile={openProfile} />
              : <p className={muted}>Select a section and subject to view its students.</p> },
            { id: "support", label: "Learning Support", content: (
              <LearningSupport key={scopeKey} entries={support} rules={rules} onProfile={openProfile} generating={generating}
                onGenerate={(result) => onGenerate(result.student, result.supportType, { year, term, subjectId: result.assignment.subjectId })} />
            ) },
            { id: "assessments", label: "Assessment Results", content: (
              <AssessmentResults key={scopeKey} rows={assessmentResults} deletingId={deletingId}
                onView={(row) => setDetail({ kind: "assessment", row })}
                onEdit={openEditor} onRemove={removeAssessment} onCreate={() => openEditor()}
                year={year} onStatusChanged={updateAssessmentStatus}
                onOpenLibrary={isActiveYear ? onOpenLibrary : undefined} hasSubjects={data.subjects.length > 0} />
            ) },
          ]} />
      )}
    </div>
  );
}

function DashboardFolderTabs({ host, selected, onSelect, folders }) {
  const prefix = useId();
  const tabList = useRef(null);

  useLayoutEffect(() => {
    const list = tabList.current;
    if (!list || list.scrollWidth <= list.clientWidth) return;

    const activeTab = list.querySelector('[aria-selected="true"]');
    if (!activeTab) return;

    const listBounds = list.getBoundingClientRect();
    const tabBounds = activeTab.getBoundingClientRect();
    const { paddingLeft, paddingRight } = window.getComputedStyle(list);
    const visibleLeft = listBounds.left + parseFloat(paddingLeft);
    const visibleRight = listBounds.right - parseFloat(paddingRight);
    if (tabBounds.left < visibleLeft) {
      list.scrollLeft += tabBounds.left - visibleLeft;
    } else if (tabBounds.right > visibleRight) {
      list.scrollLeft += tabBounds.right - visibleRight;
    }
  }, [host, selected]);

  function handleKeyDown(event, index) {
    let nextIndex;
    switch (event.key) {
      case "ArrowLeft": nextIndex = (index + folders.length - 1) % folders.length; break;
      case "ArrowRight": nextIndex = (index + 1) % folders.length; break;
      case "Home": nextIndex = 0; break;
      case "End": nextIndex = folders.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const { id } = folders[nextIndex];
    onSelect(id);
    document.getElementById(`${prefix}-tab-${id}`)?.focus();
  }

  return <div>
    {host && createPortal(
      <div ref={tabList} className="dashboard-folder-tabs" role="tablist" aria-label="Dashboard reports">
        {folders.map(({ id, label }, index) => (
          <button key={id} type="button" role="tab" className="dashboard-folder-tab" id={`${prefix}-tab-${id}`}
            aria-selected={id === selected} aria-controls={`${prefix}-panel-${id}`} tabIndex={id === selected ? 0 : -1}
            onClick={() => onSelect(id)} onKeyDown={(event) => handleKeyDown(event, index)}>{label}</button>
        ))}
      </div>,
      host,
    )}
    {folders.map(({ id, content }) => (
      <section key={id} role="tabpanel" id={`${prefix}-panel-${id}`} aria-labelledby={`${prefix}-tab-${id}`}
        className={id === "dashboard" ? "space-y-6" : undefined} tabIndex={0} hidden={id !== selected}>
        {content}
      </section>
    ))}
  </div>;
}

function ReportSelect({ label, value, options, disabled, onChange }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-sm font-semibold text-[var(--ed-text)]">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-2 py-2 text-sm text-[var(--ed-text)] disabled:opacity-65">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Heading({ title, children, compact = false }) {
  const Title = compact ? "h4" : "h2";
  return <div>
    <Title className={`${compact ? "font-semibold" : "text-2xl font-bold"} text-[var(--ed-text)]`}>{title}</Title>
    {children && <p className={`mt-2 ${muted}`}>{children}</p>}
  </div>;
}

function ResultsTable({ label, headings, rows, empty }) {
  const [page, setPage] = useState(1);
  if (!rows.length) return <p className={`mt-4 rounded-xl bg-[var(--ed-subtle)] p-4 ${muted}`}>{empty}</p>;

  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--ed-border)]" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full min-w-[590px] border-collapse text-left text-sm">
          <thead className="bg-[var(--ed-subtle)]">
            <tr>{headings.map((heading) => <th key={heading} scope="col" className="px-4 py-3 font-semibold text-[var(--ed-text)]">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--ed-border)]">
            {rows.slice(start, start + PAGE_SIZE).map(({ key, cells }) => (
              <tr key={key}>
                {cells.map((cell, index) => <td key={headings[index]} className="max-w-[20rem] break-words px-4 py-3 align-top">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ResultsPagination page={currentPage} count={rows.length} onPageChange={setPage} />
    </>
  );
}

function ResultsPagination({ page, count, onPageChange }) {
  const pages = Math.ceil(count / PAGE_SIZE);
  if (pages <= 1) return null;
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
    <p className={muted}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)} of {count}</p>
    <div className="flex gap-2">
      <button type="button" className={button} disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</button>
      <button type="button" className={button} disabled={page === pages} onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  </div>;
}

function basisLabel(assignment) {
  if (assignment.average === null) return "No recorded results";
  if (assignment.provisionalCount === 0) return "Official term grades";
  return assignment.provisionalCount === assignment.assessed.length ? "In progress" : "Includes in-progress averages";
}

function GradeValue({ value, basis }) {
  return <span className="font-semibold tabular-nums">{metric(value)}
    {basis && <span className="block text-xs font-normal text-[var(--ed-muted)]">{basis}</span>}
  </span>;
}

function SummaryCards({ classes, selectedClass, passingGrade }) {
  const totals = summarizeOverview(classes);
  let metrics = [
    ["Grade Levels Handled", totals.gradeLevels, "Within the selected assignments"],
    ["Sections Handled", totals.sections, "Distinct sections within each grade level"],
    ["Unique Students Handled", totals.students, "Enrolled students counted once across subjects"],
    ["Students Below Threshold", totals.below, `Unique students below ${passingGrade} in at least one selected subject`],
  ];
  if (selectedClass) {
    const { average, assessed, students, below, passingCount, passingRate } = selectedClass;
    const coverage = students.length ? assessed.length / students.length * 100 : null;
    metrics = [
      ["Average Performance", metric(average), `Mean of assessed students’ subject averages · ${basisLabel(selectedClass)}`],
      ["Passing Rate", metric(passingRate, "%"), `${passingCount} of ${assessed.length} assessed students meet the threshold of ${passingGrade}`],
      ["Assessed / Enrolled Students", `${assessed.length} / ${students.length}`, `${metric(coverage, "%")} assessed · ${students.length - assessed.length} without a recorded average`],
      ["Students Below Threshold", below.length, `Recorded subject average below ${passingGrade}`],
    ];
  }
  return <section aria-label="Performance summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {metrics.map(([label, value, description]) => <div key={label} className={card}>
      <h3 className="font-semibold text-[var(--ed-text)]">{label}</h3>
      <p className="my-1 text-4xl font-extrabold tabular-nums text-[var(--ed-primary)]">{value}</p>
      <p className={muted}>{description}</p>
    </div>)}
  </section>;
}

function MyClassCards({ classes, term, summaries, passingGrade, onSelect }) {
  return <section aria-label="My Classes" className="space-y-4">
    <Heading title="My Classes" />
    {classes.length === 0 ? (
      <p className={`rounded-xl bg-[var(--ed-subtle)] p-4 ${muted}`}>{EMPTY_CLASSES}</p>
    ) : (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-4">
        {classes.map((assignment) => (
          <ClassOverviewCard key={assignment.id} assignment={assignment} term={term} summaries={summaries}
            passingGrade={passingGrade} onSelect={onSelect} />
        ))}
      </div>
    )}
  </section>;
}

function ClassOverviewCard({ assignment, term, summaries, passingGrade, onSelect }) {
  const { subjectName, assessed, students, average, passingRate, below } = assignment;
  const classLabel = assignmentLabel(assignment);
  const metrics = [
    ["Assessed / Enrolled", `${assessed.length} / ${students.length}`],
    ["Class Average", <GradeValue value={average} basis={basisLabel(assignment)} />],
    ["Passing Rate", metric(passingRate, "%")],
    [`Students Below ${passingGrade}`, below.length],
  ];
  return <article aria-label={`${classLabel} · ${subjectName}`} className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-[var(--ed-border)] bg-[var(--ed-surface)] p-4 sm:p-5">
    <div>
      <h3 className="break-words text-lg font-bold text-[var(--ed-text)]">{subjectName}</h3>
      <p className={`break-words ${muted}`}>{classLabel}</p>
    </div>
    <dl className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--ed-subtle)] p-3">
      {metrics.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="break-words text-xs font-semibold text-[var(--ed-secondary)]">{label}</dt>
          <dd className="mt-1 font-semibold tabular-nums text-[var(--ed-text)]">{value}</dd>
        </div>
      ))}
    </dl>
    <StudentDistribution assignment={assignment} term={term} compact />
    <TermTrend assignment={assignment} summaries={summaries} passingGrade={passingGrade} compact />
    <button type="button" className={`mt-auto self-start ${button}`} aria-label={`View ${classLabel} · ${subjectName}`}
      onClick={() => onSelect(assignment)}>View class</button>
  </article>;
}

function Bar({ value }) {
  return <div aria-hidden="true" className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--ed-border)]">
    {value !== null && <div className="h-full rounded-full bg-[var(--ed-primary)]" style={{ width: `${value}%` }} />}
  </div>;
}

function SubjectPerformance({ classes, term, scopeKey }) {
  const [chartSubject, setChartSubject] = useState("ALL");
  const [chartView, setChartView] = useState("averages");
  const showCategories = chartView === "categories";
  const subjects = new Map(classes.map(({ subjectId, subjectName }) => [subjectId, subjectName]));
  const subject = subjects.has(chartSubject) ? chartSubject : "ALL";
  const subjectOptions = [...subjects].sort((first, second) => first[1].localeCompare(second[1]))
    .map(([value, label]) => ({ value, label }));
  const visibleClasses = subject === "ALL" ? classes : classes.filter(({ subjectId }) => subjectId === subject);

  return <section className={card}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <Heading title="Subject Performance">
        {showCategories ? `Student performance categories for ${termLabel(term)}.` :
          `Compare section averages within the same grade and subject for ${termLabel(term)}.`}
      </Heading>
      <div className="flex min-w-0 flex-wrap gap-3">
        <ReportSelect label="Chart subject" value={subject} disabled={subjects.size < 2}
          options={[{ value: "ALL", label: "All subjects" }, ...subjectOptions]} onChange={setChartSubject} />
        <ReportSelect label="Chart view" value={chartView} onChange={setChartView}
          options={[{ value: "averages", label: "Class averages" }, { value: "categories", label: "Performance categories" }]} />
      </div>
    </div>
    {visibleClasses.length ? (
      <SubjectPerformanceBars key={`${scopeKey}:${subject}:${chartView}`} classes={visibleClasses} showCategories={showCategories} />
    ) : <p className={`mt-4 rounded-xl bg-[var(--ed-subtle)] p-4 ${muted}`}>{EMPTY_CLASSES}</p>}
  </section>;
}

function SubjectPerformanceBars({ classes, showCategories }) {
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, Math.ceil(classes.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const recordedCount = classes.filter(({ average }) => average !== null).length;
  const orderedClasses = [...classes].sort((first, second) =>
    Number(first.average === null) - Number(second.average === null) ||
    first.grade - second.grade || first.subjectName.localeCompare(second.subjectName));
  const pageClasses = orderedClasses.slice(start, start + PAGE_SIZE);
  const maximum = showCategories ? Math.max(1, ...classes.map(({ students }) => students.length)) : 100;
  const tickStep = Math.ceil(maximum / 4);
  const ticks = Array.from({ length: Math.ceil(maximum / tickStep) + 1 }, (_, index) => index * tickStep);
  const scale = ticks.at(-1);

  return <figure className="mt-5" aria-label="Subject Performance bar chart">
    <figcaption className={muted}>
      {showCategories ? "Each column counts students in one teaching assignment. Incomplete means no recorded average for the selected term." :
        `Averages use assessed students’ subject grades on a 0–100 scale. ${recordedCount} of ${classes.length} class averages available.`}
    </figcaption>
    {showCategories && <ul aria-label="Student performance categories" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--ed-secondary)]">
      {PERFORMANCE_LEVELS.map(({ label, color }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />{label}
        </li>
      ))}
    </ul>}
    <div className="mt-3 flex min-w-0 gap-2 [--subject-chart-height:14rem]">
      <div aria-hidden="true" className="relative mt-8 h-[var(--subject-chart-height)] w-7 shrink-0 text-right text-xs tabular-nums text-[var(--ed-muted)]">
        {ticks.map((tick) => (
          <span key={tick} className="absolute right-0 translate-y-1/2" style={{ bottom: `${tick / scale * 100}%` }}>{tick}</span>
        ))}
      </div>
      <div className="minimal-scrollbar min-w-0 flex-1 overflow-x-auto pb-2" role="region" aria-label="Subject performance columns" tabIndex={0}>
        <div className="relative pt-8" style={{ minWidth: `${pageClasses.length * 6}rem` }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-8 h-[var(--subject-chart-height)]">
            {ticks.map((tick) => (
              <span key={tick} className="absolute inset-x-0 border-t border-[var(--ed-border)]" style={{ bottom: `${tick / scale * 100}%` }} />
            ))}
          </div>
          <ul className="relative grid auto-cols-fr grid-flow-col">
            {pageClasses.map((item) => (
              <SubjectPerformanceColumn key={item.id} assignment={item} showCategories={showCategories} scale={scale} />
            ))}
          </ul>
        </div>
      </div>
    </div>
    <ResultsPagination page={currentPage} count={classes.length} onPageChange={setPage} />
  </figure>;
}

function SubjectPerformanceColumn({ assignment, showCategories, scale }) {
  const { subjectName, average, assessed, students } = assignment;
  const label = assignmentLabel(assignment);
  const score = metric(average);
  const columnLabel = `${subjectName}, ${label}.`;
  const categories = showCategories ? [
    ...summarizeDistribution(assessed),
    { ...getPerformanceStatus(null), count: students.length - assessed.length },
  ].filter(({ count }) => count > 0).reverse() : [];

  return <li className="min-w-0 text-center">
    <div className="flex h-[var(--subject-chart-height)] justify-center">
      <div className="flex w-2/3 max-w-14 flex-col-reverse">
        {showCategories ? categories.map(({ label: category, color, count }) => (
          <SubjectPerformanceBar key={category} height={count / scale * 100} color={color} value={count}
            label={`${columnLabel} ${category}. ${count} ${count === 1 ? "student" : "students"}.`} />
        )) : average !== null && (
          <SubjectPerformanceBar height={average} color="var(--ed-primary)" value={score}
            label={`${columnLabel} Average ${score}.`} classAverage />
        )}
      </div>
    </div>
    <div className="mt-2 break-words px-1 text-xs leading-snug text-[var(--ed-muted)]">
      <p className="text-sm font-semibold text-[var(--ed-text)]">{subjectName}</p>
      <p>{label}</p>
      <p className="mt-1">{showCategories ? `${students.length} enrolled` : `${basisLabel(assignment)} · ${assessed.length} assessed`}</p>
    </div>
  </li>;
}

function SubjectPerformanceBar({ height, color, value, label, classAverage = false }) {
  const [tooltipOffset, setTooltipOffset] = useState(null);

  function showValue({ currentTarget }) {
    const bar = currentTarget.getBoundingClientRect();
    const plot = currentTarget.closest('[role="region"]').getBoundingClientRect();
    const offset = Math.max(0, plot.left - bar.left) + Math.min(0, plot.right - bar.right);
    setTooltipOffset(offset);
  }

  return <div className="relative shrink-0" style={{ height: `${height}%` }}>
    <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-full ${classAverage ? "min-h-0.5 rounded-t-md" : ""}`}
      style={{ backgroundColor: color }} />
    <button type="button" className={`absolute inset-x-0 bottom-0 h-full w-full cursor-pointer ${classAverage ? "min-h-11 rounded-t-md" : ""}`}
      aria-label={label} onPointerEnter={showValue} onPointerLeave={() => setTooltipOffset(null)}
      onFocus={showValue} onBlur={() => setTooltipOffset(null)} onClick={showValue}>
      {tooltipOffset !== null && <span aria-hidden="true" style={{ left: tooltipOffset }}
        className="pointer-events-none absolute bottom-full z-10 mb-1 w-full rounded-md bg-[var(--ed-text)] py-1 text-center text-xs font-semibold tabular-nums text-[var(--ed-surface)]">
        {value}
      </span>}
    </button>
  </div>;
}

function StudentDistribution({ assignment, term, compact = false }) {
  const bands = summarizeDistribution(assignment.assessed);
  const assessed = assignment.assessed.length;
  const populatedBands = bands.filter(({ count }) => count > 0);
  let background = populatedBands[0]?.color ?? "var(--ed-border)";
  if (populatedBands.length > 1) {
    let cumulativeCount = 0;
    const slices = populatedBands.map(({ count, color }) => {
      const start = cumulativeCount / assessed * 100;
      cumulativeCount += count;
      const end = cumulativeCount / assessed * 100;
      return `${color} ${start}% ${end}%`;
    });
    background = `conic-gradient(${slices.join(", ")})`;
  }
  const largestSize = Math.max(...bands.map(({ count }) => count));
  const largest = bands.filter(({ count }) => count === largestSize);
  const labels = new Intl.ListFormat("en").format(largest.map(({ label }) => label));
  const summary = largest.length === 1 ? `${labels} has the most assessed students.` : `${labels} are tied for the largest group.`;
  return <section className={compact ? "border-t border-[var(--ed-border)] pt-4" : card}>
    <Heading title="Student Distribution" compact={compact}>
      {assessed} assessed · {assignment.students.length - assessed} without a calculated {termLabel(term)} average.
    </Heading>
    <figure className="mt-3" aria-label="Distribution by performance band">
      <figcaption className={muted}>
        {assessed ? <>{!compact && "Each slice shows a share of assessed students. "}{summary}</> : "No recorded averages are available for this term."}
      </figcaption>
      <div className={`flex flex-wrap items-center ${compact ? "mt-3 gap-3" : "mt-5 gap-x-6 gap-y-5"}`}>
        <div aria-hidden="true" className={`flex justify-center ${compact ? "flex-[1_1_6rem]" : "flex-[1_1_9rem]"}`}>
          <div className={`grid aspect-square shrink-0 place-items-center rounded-full ${compact ? "w-24" : "w-36 sm:w-40"}`} style={{ background }}>
            <div className="flex size-[68%] flex-col items-center justify-center rounded-full bg-[var(--ed-surface)]">
              <span className={`${compact ? "text-xl" : "text-3xl"} font-extrabold tabular-nums text-[var(--ed-text)]`}>{assessed}</span>
              <span className="text-xs text-[var(--ed-muted)]">Assessed</span>
            </div>
          </div>
        </div>
        <ul className={`grid min-w-0 ${compact ? "flex-[2_1_10rem] gap-2" : "flex-[2_1_13rem] gap-2.5"}`}>
          {bands.map((band) => <li key={band.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
            <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: band.color }} />
            <div className={compact ? "flex flex-wrap items-baseline gap-x-2" : undefined}>
              <p className="text-sm font-semibold">{band.label}</p>
              <p className="text-xs text-[var(--ed-muted)]">{band.range}</p>
            </div>
            <span className="text-right text-sm tabular-nums">{band.count} · {metric(band.percentage, "%")}</span>
          </li>)}
        </ul>
      </div>
    </figure>
  </section>;
}

function TermTrend({ assignment, summaries, passingGrade, compact = false }) {
  const terms = TERM_NUMBERS.map((term) => ({ term, ...summarizeAssignment(assignment, summaries, term, passingGrade) }));
  const recorded = terms.filter(({ average }) => average !== null);
  let description = recorded.length ? "Only one term has recorded results so far." : "No terms have recorded results yet.";
  if (recorded.length >= 2) {
    const first = recorded[0], last = recorded.at(-1);
    const change = Number(last.average.toFixed(1)) - Number(first.average.toFixed(1));
    const window = `from ${termLabel(first.term)} to ${termLabel(last.term)}`;
    description = change === 0 ? `The recorded class average was steady to one decimal place ${window}.` :
      `The recorded class average ${change > 0 ? "rose" : "fell"} by ${Math.abs(change).toFixed(1)} points ${window}.`;
  }
  return <section className={compact ? "border-t border-[var(--ed-border)] pt-4" : card}>
    <Heading title="Term Performance Trend" compact={compact}>
      {!compact && "Students with recorded results may differ between terms."}
    </Heading>
    <figure className="mt-3">
      <figcaption className={muted}>{description}</figcaption>
      <ol className={compact ? "mt-3 space-y-2" : "mt-4 space-y-4"}>
        {terms.map((item) => <li key={item.term}>
          <div className="flex flex-wrap justify-between gap-x-3">
            <div><p className="font-semibold">{termLabel(item.term)}</p><p className={muted}>{item.assessed.length} assessed</p></div>
            <GradeValue value={item.average} basis={basisLabel(item)} />
          </div>
          <Bar value={item.average} />
        </li>)}
      </ol>
    </figure>
  </section>;
}

function StudentList({ assignment, search, onSearch, onProfile }) {
  const query = search.trim().toLowerCase();
  const results = assignment.results.filter(({ student }) => student.name.toLowerCase().includes(query));
  return <>
    <input type="search" aria-label="Search students in selected class" placeholder="Search by student name" value={search}
      onChange={(event) => onSearch(event.target.value)} className="w-full max-w-xs rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2 text-sm" />
    <ResultsTable key={query} label="Student List" headings={["Student", "Grade / Section", "Subject Average", "Performance Band", "Profile"]}
      empty={query ? "No students match the search." : "No students are enrolled in this assignment."}
      rows={results.map(({ student, grade, isProvisional }) => ({
        key: student.id,
        cells: [
          student.name, assignmentLabel(assignment), <GradeValue value={grade} basis={grade === null ? "" : isProvisional ? "In progress" : "Official term grade"} />,
          grade === null ? "No recorded average" : getPerformanceStatus(grade).label,
          <button type="button" className={actionLink} aria-label={`View profile for ${student.name}`} onClick={() => onProfile(student)}>View profile</button>,
        ],
      }))} />
  </>;
}

function LearningSupport({ entries, rules, onProfile, onGenerate, generating }) {
  return <>
    <p className={muted}>
      Rule-based flags use subject averages below {rules.passingGrade} for intervention and averages at or above {rules.highPerformingGrade} for enrichment.
    </p>
    <ResultsTable label="Learning Support" headings={["Student", "Grade / Section", "Subject", "Average", "Classification", "Recommendation"]}
      empty="No recorded subject averages meet the support or enrichment rules for this scope."
      rows={entries.map((entry) => {
        const { student, assignment, grade, isProvisional, supportType } = entry;
        const key = `${supportType}-${student.id}-${assignment.subjectId}`;
        return { key, cells: [
          <button type="button" className={actionLink} onClick={() => onProfile(student)}>{student.name}</button>,
          assignmentLabel(assignment), assignment.subjectName,
          <GradeValue value={grade} basis={isProvisional ? "In progress" : "Official term grade"} />,
          supportType === "intervention" ? "Needs intervention" : "Ready for enrichment",
          student.archived ? "Archived enrollment" :
            <button type="button" className={primaryButton} disabled={Boolean(generating)} onClick={() => onGenerate(entry)}>
              {generating === key ? "Generating…" : "Generate"}
            </button>,
        ] };
      })} />
  </>;
}

function AssessmentResults({ rows, onView, onEdit, onRemove, onCreate, onOpenLibrary, deletingId, hasSubjects, year, onStatusChanged }) {
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className={`max-w-xl ${muted}`}>Average scores are percentages of total items. Participation uses the students assigned within this scope.</p>
      <div className="flex flex-wrap gap-2">
        {onOpenLibrary && <button type="button" className={button} onClick={onOpenLibrary}>View library</button>}
        <button type="button" className={primaryButton} disabled={!hasSubjects} onClick={onCreate}>New assessment</button>
      </div>
    </div>
    <ResultsTable label="Assessment Results" headings={["Assessment", "Subject", "Grade / Section", "Date", "Assessed / Assigned", "Average Score", "Actions"]}
      empty="No assessments match the selected assignments and term."
      rows={rows.map((row) => {
        const { assessment, assignments, results, assessedCount, average } = row;
        return { key: assessment.id, cells: [
          <div>
            <AssessmentStatusControl assessment={assessment} year={year} onSaved={onStatusChanged} />
            <p className={muted}>{assessment.slot_label ?? assessment.category_label}</p>
          </div>,
          assignments[0].subjectName, assignments.map((item) => <p key={item.id}>{assignmentLabel(item)}</p>),
          assessment.date || "—", `${assessedCount} / ${results.length}`, metric(average, "%"),
          <div className="flex flex-col items-start gap-2">
            <button type="button" className={actionLink} onClick={() => onView(row)}>View results</button>
            <button type="button" className={actionLink} onClick={() => onEdit(assessment.id)}>Edit</button>
            <button type="button" className="text-sm font-semibold text-[var(--ed-danger)] hover:underline disabled:opacity-50" disabled={Boolean(deletingId)}
              onClick={() => onRemove(assessment)}>{deletingId === assessment.id ? "Deleting…" : "Delete"}</button>
          </div>,
        ] };
      })} />
  </>;
}

function AssessmentDetail({ row, onEdit }) {
  const { assessment, assignments, results } = row;
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <Heading title={<span className="flex flex-wrap items-center gap-2">
        <AssessmentStatusBadge status={assessment.status} date={assessment.date} />
        <span className="min-w-0 break-words">{assessment.name}</span>
      </span>}>{assignments[0].subjectName} · {termLabel(assessment.term)} · {assessment.date}</Heading>
      <button type="button" className={button} onClick={onEdit}>Edit assessment</button>
    </div>
    <ResultsTable label="Individual assessment results" headings={["Student", "Grade / Section", "Score", "Percentage"]} empty="No students are assigned in this scope."
      rows={results.map(({ student, score, percentage }) => ({
        key: student.id,
        cells: [
          student.name, `Grade ${student.grade} · Section ${student.section}`,
          score === null ? "No recorded score" : `${score} / ${assessment.total_items}`, metric(percentage, "%"),
        ],
      }))} />
  </>;
}

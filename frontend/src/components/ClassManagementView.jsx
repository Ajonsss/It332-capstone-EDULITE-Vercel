import { lazy, Suspense, useMemo, useState } from "react";
import { buildClassHierarchy } from "../utils/classHierarchy.js";
import AddClassDrawer from "./AddClassDrawer";
import ModifyClassDrawer from "./ModifyClassDrawer";
import ClassSidePanel from "./ClassSidePanel";
import LoadingIndicator from "./LoadingIndicator";

const StudentForm = lazy(() => import("./StudentForm"));
const action = "text-xs font-semibold text-[var(--ed-accent-text)] hover:underline";

export default function ClassManagementView({ sections, subjects, students, classes = [], onRefresh, schoolYearName,
  onEditStudent, onDeleteStudent, onOpenRecords, studentEditorOpen, studentFormId, onCancelStudentForm, onSaveStudentForm }) {
  const [gradeLevel, setGradeLevel] = useState(null), [sectionId, setSectionId] = useState(""), [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState(""), [addingClass, setAddingClass] = useState(false), [editingBusy, setEditingBusy] = useState(false);
  const [modifyingClass, setModifyingClass] = useState(false);
  const hierarchy = useMemo(() => buildClassHierarchy({ sections, subjects, students, classes }), [sections, subjects, students, classes]);
  const grade = hierarchy.find((item) => item.grade === gradeLevel);
  const section = grade?.sections.find((item) => String(item.id) === sectionId);
  const subject = section?.subjects.find((item) => String(item.id) === subjectId);
  const filteredStudents = (subject?.students ?? []).filter((student) => !search.trim() || `${student.name} ${student.grade} ${student.section}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns = subject ? "xl:grid-cols-[minmax(0,.75fr)_minmax(0,.85fr)_minmax(0,1fr)_minmax(0,1.5fr)]" : section ? "xl:grid-cols-3 max-w-6xl" : grade ? "md:grid-cols-2 max-w-4xl" : "max-w-md";

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm text-[var(--ed-muted)]">Browse your registered classes.</p><p className="mt-1 text-xs text-[var(--ed-muted)]">Grade Level → Section → Subject → Students</p></div>
      <div className="ml-auto flex flex-wrap gap-3">
        <button type="button" onClick={() => setModifyingClass(true)} className="rounded-xl border border-[var(--ed-border)] px-5 py-3 text-sm font-semibold hover:bg-[var(--ed-subtle)] disabled:opacity-50">Modify class</button>
        <button type="button" onClick={() => setAddingClass(true)} className="rounded-xl bg-[var(--ed-primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]">Add class</button>
      </div>
    </div>
    <nav aria-label="Selected class" className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className={action} onClick={() => { setGradeLevel(null); setSectionId(""); setSubjectId(""); setSearch(""); }}>Grade levels</button>
      {grade && <><span aria-hidden="true">/</span><button type="button" className={action} onClick={() => { setSectionId(""); setSubjectId(""); setSearch(""); }}>Grade {grade.grade}</button></>}
      {section && <><span aria-hidden="true">/</span><button type="button" className={action} onClick={() => { setSubjectId(""); setSearch(""); }}>{section.name}</button></>}
      {subject && <><span aria-hidden="true">/</span><span aria-current="page">{subject.name}</span></>}
    </nav>
    <div aria-label="Class management columns" className={`grid grid-cols-1 items-start gap-4 ${grade && section ? "md:grid-cols-2" : ""} ${columns}`}>
      <BrowserColumn title="Grade Levels" count={hierarchy.length}>
        {hierarchy.map((item) => <BrowserChoice key={item.grade} label={`Grade ${item.grade}`} active={grade?.grade === item.grade} detail={`${item.sections.length} section${item.sections.length === 1 ? "" : "s"}`} onClick={() => { setGradeLevel(item.grade); setSectionId(""); setSubjectId(""); setSearch(""); }} />)}
        {!hierarchy.length && <EmptyList>No registered classes yet. Select Add class to get started.</EmptyList>}
      </BrowserColumn>
      {grade && <BrowserColumn title="Sections" count={grade.sections.length} description={`Grade ${grade.grade}`}>
        {grade.sections.map((item) => <BrowserChoice key={item.id} label={item.name} active={section?.id === item.id} detail={`${item.subjects.length} subjects · ${item.students.length} students`} onClick={() => { setSectionId(String(item.id)); setSubjectId(""); setSearch(""); }} />)}
        {!grade.sections.length && <EmptyList>No sections registered yet. Use Modify class to add a section.</EmptyList>}
      </BrowserColumn>}
      {section && <BrowserColumn title="Subjects" count={section.subjects.length} description={`Grade ${grade.grade} · ${section.name}`}>
        {section.subjects.map((item) => <BrowserChoice key={item.id} label={item.name} active={subject?.id === item.id} detail={`${item.students.length} enrolled`} onClick={() => { setSubjectId(String(item.id)); setSearch(""); }} />)}
        {!section.subjects.length && <EmptyList>No subjects registered for this section. Use Add class to connect a subject.</EmptyList>}
      </BrowserColumn>}
      {subject && <BrowserColumn title="Students" count={subject.students.length} description={`${section.name} · ${subject.name}`}>
        <label className="mx-1 mb-3 block text-xs font-semibold">Search students<input aria-label="Search class students" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student name" className="mt-2 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm" /></label>
        {filteredStudents.map((student) => <article key={student.id} className="space-y-3 border-t border-[var(--ed-border)] px-2 py-4">
          <div><h3 className="break-words text-sm font-bold">{student.name}</h3><p className="mt-1 text-xs text-[var(--ed-muted)]">Grade {student.grade} · {student.section}</p></div>
          <div className="flex flex-wrap gap-4">
            <button type="button" aria-label={`View records for ${student.name}`} className={action} onClick={() => onOpenRecords(student)}>Records</button>
            <button type="button" aria-label={`Edit student ${student.name}`} className={action} onClick={() => onEditStudent(student.id)}>Edit</button>
            <button type="button" aria-label={`Delete student ${student.name}`} className="text-xs font-semibold text-[var(--ed-danger)] hover:underline" onClick={() => onDeleteStudent(student.id)}>Delete</button>
          </div>
        </article>)}
        {!filteredStudents.length && <EmptyList>{subject.students.length ? "No students match your search." : "No students enrolled yet. Select Add class and choose this grade, section, and subject to register or import students."}</EmptyList>}
      </BrowserColumn>}
    </div>
    {addingClass && <AddClassDrawer sections={sections} subjects={subjects} students={students} initialGrade={grade?.grade ?? ""} initialSectionId={section?.id ?? ""} initialSubjectId={subject?.id ?? ""} schoolYearName={schoolYearName} onRefresh={onRefresh} onClose={() => setAddingClass(false)} onRegistered={async (item) => {
      await onRefresh(); setGradeLevel(item.grade); setSectionId(item.section_id); setSubjectId(item.subject.id); setSearch("");
    }} />}
    {modifyingClass && <ModifyClassDrawer hierarchy={hierarchy} sections={sections} subjects={subjects} initialGrade={grade?.grade} initialSectionId={section?.id} onChanged={async () => { await onRefresh(); setGradeLevel(null); setSectionId(""); setSubjectId(""); setSearch(""); }} onClose={() => setModifyingClass(false)} onSaved={async (item) => {
      await onRefresh(); setGradeLevel(item.grade); setSectionId(item.section_id); setSubjectId(item.subject_ids.includes(subjectId) ? subjectId : item.subject_ids[0] ?? ""); setSearch("");
    }} />}
    {studentEditorOpen && <ClassSidePanel title="Edit student" busy={editingBusy} onClose={onCancelStudentForm}>
      <Suspense fallback={<LoadingIndicator label="Loading student form..." />}><StudentForm key={studentFormId} compact embedded studentId={studentFormId} onBusyChange={setEditingBusy} onCancel={onCancelStudentForm} onSaved={onSaveStudentForm} /></Suspense>
    </ClassSidePanel>}
  </div>;
}

function BrowserColumn({ title, count, description, children }) {
  return <section aria-label={title} className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-surface)]">
    <header className="border-b border-[var(--ed-border)] bg-[var(--ed-subtle)] p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-bold">{title}</h2><span className="rounded-full border border-[var(--ed-border)] px-2.5 py-1 text-xs">{count}</span></div>{description && <p className="mt-1 break-words text-xs text-[var(--ed-muted)]">{description}</p>}</header>
    <div className="minimal-scrollbar max-h-[640px] space-y-2 overflow-y-auto p-3">{children}</div>
  </section>;
}
function BrowserChoice({ label, detail, active, onClick }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left ${active ? "border-[var(--ed-primary)] bg-[var(--ed-accent-soft)] text-[var(--ed-accent-text)]" : "border-[var(--ed-border)] hover:bg-[var(--ed-subtle)]"}`}>
    <span className="min-w-0"><span className="block break-words text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-[var(--ed-muted)]">{detail}</span></span><span aria-hidden="true">›</span>
  </button>;
}
function EmptyList({ children }) { return <p className="px-2 py-6 text-sm leading-6 text-[var(--ed-muted)]">{children}</p>; }

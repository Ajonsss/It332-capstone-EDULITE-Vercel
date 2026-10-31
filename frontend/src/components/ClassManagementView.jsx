import { lazy, Suspense, useMemo, useState } from "react";
import { buildClassHierarchy } from "../utils/classHierarchy.js";
import AddClassDrawer from "./AddClassDrawer";
import ModifyClassDrawer from "./ModifyClassDrawer";
import ClassSidePanel from "./ClassSidePanel";
import LoadingIndicator from "./LoadingIndicator";
import FilterSidebar from "./FilterSidebar";

const StudentForm = lazy(() => import("./StudentForm"));
const action = "text-xs font-semibold text-[var(--ed-accent-text)] hover:underline";

export default function ClassManagementView({ sections, subjects, students, classes = [], onRefresh, schoolYearName,
  onEditStudent, onDeleteStudent, onOpenRecords, studentEditorOpen, studentFormId, onCancelStudentForm, onSaveStudentForm }) {
  const [gradeLevel, setGradeLevel] = useState(null), [sectionId, setSectionId] = useState(""), [subjectId, setSubjectId] = useState("");
  const [search, setSearch] = useState(""), [addingClass, setAddingClass] = useState(false), [editingBusy, setEditingBusy] = useState(false);
  const [modifyingClass, setModifyingClass] = useState(false);
  const hierarchy = useMemo(() => buildClassHierarchy({ sections, subjects, students, classes }), [sections, subjects, students, classes]);
  const grade = hierarchy.find((item) => item.grade === gradeLevel) ?? hierarchy[0];
  const section = grade?.sections.find((item) => String(item.id) === String(sectionId)) ?? grade?.sections[0];
  const subject = section?.subjects.find((item) => String(item.id) === String(subjectId)) ?? section?.subjects[0];
  const filteredStudents = (subject?.students ?? []).filter((student) => !search.trim() || `${student.name} ${student.grade} ${student.section}`.toLowerCase().includes(search.trim().toLowerCase()));

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
    <div aria-label="Class management columns" className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,.75fr)_minmax(0,.85fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
      <BrowserColumn title="Grade Levels" count={hierarchy.length}>
        {hierarchy.map((item) => <BrowserChoice key={item.grade} label={`Grade ${item.grade}`} active={grade?.grade === item.grade} detail={`${item.sections.length} section${item.sections.length === 1 ? "" : "s"}`} onClick={() => { setGradeLevel(item.grade); setSectionId(""); setSubjectId(""); setSearch(""); }} />)}
        {!hierarchy.length && <EmptyList>No registered classes yet. Select Add class to get started.</EmptyList>}
      </BrowserColumn>
      <BrowserColumn title="Sections" count={grade?.sections.length ?? 0} description={grade ? `Grade ${grade.grade}` : undefined}>
        {grade?.sections.map((item) => <BrowserChoice key={item.id} label={item.name} active={section?.id === item.id} detail={`${item.subjects.length} subjects · ${item.students.length} students`} onClick={() => { setSectionId(String(item.id)); setSubjectId(""); setSearch(""); }} />)}
        {!grade?.sections.length && <EmptyList>{grade ? "No sections registered yet. Use Modify class to add a section." : "Add a grade level to get started."}</EmptyList>}
      </BrowserColumn>
      <BrowserColumn title="Subjects" count={section?.subjects.length ?? 0} description={section ? `Grade ${grade.grade} · ${section.name}` : undefined}>
        {section?.subjects.map((item) => <BrowserChoice key={item.id} label={item.name} active={subject?.id === item.id} detail={`${item.students.length} enrolled`} onClick={() => { setSubjectId(String(item.id)); setSearch(""); }} />)}
        {!section?.subjects.length && <EmptyList>{section ? "No subjects registered for this section. Use Add class to connect a subject." : "Add a section to view its subjects."}</EmptyList>}
      </BrowserColumn>
      <BrowserColumn title="Students" count={subject?.students.length ?? 0} description={subject ? `${section.name} · ${subject.name}` : undefined}>
        {subject && <div className="mx-1 mb-3 flex justify-end">
          <FilterSidebar title="Filter class students" activeCount={search.trim() ? 1 : 0} onReset={() => setSearch("")}>
            <label className="block text-sm font-semibold">Search students<input aria-label="Search class students" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student name, grade, or section" className="mt-2 w-full rounded-xl border border-[var(--ed-border)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm" /></label>
          </FilterSidebar>
        </div>}
        {filteredStudents.map((student) => <article key={student.id} className="space-y-3 border-t border-[var(--ed-border)] px-2 py-4">
          <div><h3 className="break-words text-sm font-bold">{student.name}</h3><p className="mt-1 text-xs text-[var(--ed-muted)]">Grade {student.grade} · {student.section}</p></div>
          <div className="flex flex-wrap gap-4">
            <button type="button" aria-label={`View records for ${student.name}`} className={action} onClick={() => onOpenRecords(student)}>Records</button>
            <button type="button" aria-label={`Edit student ${student.name}`} className={action} onClick={() => onEditStudent(student.id)}>Edit</button>
            <button type="button" aria-label={`Delete student ${student.name}`} className="text-xs font-semibold text-[var(--ed-danger)] hover:underline" onClick={() => onDeleteStudent(student.id)}>Delete</button>
          </div>
        </article>)}
        {!filteredStudents.length && <EmptyList>{!subject ? "Add a subject to view its enrolled students." : subject.students.length ? "No students match your search." : "No students enrolled yet. Select Add class and choose this grade, section, and subject to register or import students."}</EmptyList>}
      </BrowserColumn>
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
  const detail = description ?? { "Grade Levels": "Registered grade levels for this school year.", Sections: "Sections in the selected grade level.", Subjects: "Subjects in the selected section.", Students: "Students enrolled in the selected subject." }[title];
  return <section aria-label={title} className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ed-border)] bg-[var(--ed-surface)]">
    <header className="flex items-center gap-3 border-b border-[var(--ed-border)] bg-[var(--ed-subtle)] p-4"><p className="shrink-0 text-4xl font-extrabold tabular-nums text-[var(--ed-primary)]">{count}</p><div className="min-w-0"><h2 className="font-bold">{title}</h2>{detail && <p className="mt-1 break-words text-xs text-[var(--ed-muted)]">{detail}</p>}</div></header>
    <div className="minimal-scrollbar max-h-[640px] space-y-2 overflow-y-auto p-3">{children}</div>
  </section>;
}
function BrowserChoice({ label, detail, active, onClick }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left ${active ? "border-[var(--ed-primary)] bg-[var(--ed-accent-soft)] text-[var(--ed-accent-text)]" : "border-[var(--ed-border)] hover:bg-[var(--ed-subtle)]"}`}>
    <span className="min-w-0"><span className="block break-words text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-[var(--ed-muted)]">{detail}</span></span><span aria-hidden="true">›</span>
  </button>;
}
function EmptyList({ children }) { return <p className="px-2 py-6 text-sm leading-6 text-[var(--ed-muted)]">{children}</p>; }

// Merge saved class setups with existing enrollments, without changing legacy data.
export function buildClassHierarchy({ students = [], sections = [], subjects = [], classes = [] } = {}) {
  const grades = new Map();
  const sectionMap = new Map(sections.map((section) => [String(section.id), section]));
  const subjectMap = new Map(subjects.map((subject) => [String(subject.id), subject]));
  const ensureGrade = (grade) => {
    const numericGrade = Number(grade);
    if (!Number.isSafeInteger(numericGrade) || numericGrade < 1) return null;
    if (!grades.has(numericGrade)) grades.set(numericGrade, { grade: numericGrade, sections: new Map() });
    return grades.get(numericGrade);
  };
  const ensureSection = (grade, sectionId) => {
    const numericGrade = Number(grade), section = sectionMap.get(String(sectionId));
    if (!Number.isSafeInteger(numericGrade) || numericGrade < 1 || !section) return null;
    const item = ensureGrade(numericGrade);
    if (!item.sections.has(String(section.id))) item.sections.set(String(section.id), { ...section, subjects: new Map(), students: [] });
    return item.sections.get(String(section.id));
  };
  const ensureSubject = (section, id) => {
    const subject = subjectMap.get(String(id));
    if (!section || !subject) return null;
    if (!section.subjects.has(String(id))) section.subjects.set(String(id), { ...subject, students: [] });
    return section.subjects.get(String(id));
  };
  for (const registration of classes) {
    if (registration.section_id === null) { ensureGrade(registration.grade); continue; }
    const section = ensureSection(registration.grade, registration.section_id);
    for (const id of registration.subject_ids ?? []) ensureSubject(section, id);
  }
  for (const student of students) {
    const sectionId = student.section_id ?? sections.find((section) => section.name === student.section)?.id;
    const section = ensureSection(student.grade, sectionId);
    if (!section) continue;
    section.students.push(student);
    for (const id of student.subject_ids ?? []) ensureSubject(section, id)?.students.push(student);
  }
  const byName = (first, second) => first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
  return [...grades.values()].sort((first, second) => first.grade - second.grade).map((grade) => ({
    ...grade,
    sections: [...grade.sections.values()].sort(byName).map((section) => ({ ...section,
      subjects: [...section.subjects.values()].sort(byName).map((subject) => ({ ...subject, students: subject.students.sort(byName) })),
    })),
  }));
}

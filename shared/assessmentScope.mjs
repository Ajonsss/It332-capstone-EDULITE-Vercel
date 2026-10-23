const idOf = (value) => String(value?._id ?? value ?? "");

// Missing scopes belong to older assessments that applied to the whole subject.
export function assessmentIncludesStudent(assessment, student) {
  const sections = assessment.classSections ?? assessment.class_sections;
  if (!sections?.length) return true;
  const sectionId = idOf(student.sectionId ?? student.section_id);
  return sections.some((section) => Number(section.grade) === Number(student.grade) && idOf(section.sectionId ?? section.section_id) === sectionId);
}

export function assessmentStudentFilter(classSections) {
  return classSections?.length ? { $or: classSections.map(({ grade, sectionId }) => ({ grade, sectionId })) } : {};
}

export function assessmentOverlapFilter(classSections) {
  return classSections?.length ? { $or: [
    { classSections: null }, { classSections: { $size: 0 } },
    ...classSections.map(({ grade, sectionId }) => ({ classSections: { $elemMatch: { grade, sectionId } } })),
  ] } : {};
}

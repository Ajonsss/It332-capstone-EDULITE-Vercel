export const PERFORMANCE_LEVELS = Object.freeze([
  { label: "Advancing", minimum: 90, range: "90 and above", dotClass: "bg-[#34C759]", className: "border-[#34C759] bg-[#34C759] text-white" },
  { label: "Benchmarking", minimum: 80, range: "80 to below 90", dotClass: "bg-[#007AFF]", className: "border-[#007AFF] bg-[#007AFF] text-white" },
  { label: "Connecting", minimum: 75, range: "75 to below 80", dotClass: "bg-[#FFCC00]", className: "border-[#FFCC00] bg-[#FFCC00] text-[#1C1C1E]" },
  { label: "Developing", minimum: 65, range: "65 to below 75", dotClass: "bg-[#FF9500]", className: "border-[#FF9500] bg-[#FF9500] text-white" },
  { label: "Emerging", minimum: -Infinity, range: "Below 65", dotClass: "bg-[#FF3B30]", className: "border-[#FF3B30] bg-[#FF3B30] text-white" },
  { label: "Incomplete", minimum: null, range: "No recorded performance yet", dotClass: "bg-[#8E8E93]", className: "border-[#8E8E93] bg-[#8E8E93] text-white" },
]);

export function hasPerformanceGrade(grade) {
  return typeof grade === "number" && Number.isFinite(grade);
}

export function getTermPerformanceGrade(term) {
  // Older API responses contain only termGrade. A current response explicitly
  // reports null when there is no usable evidence for a performance estimate.
  const grade = term?.performance ? term.performance.grade : term?.termGrade;
  return hasPerformanceGrade(grade) ? grade : null;
}

export function summarizeTermPerformance(summaries, termKey) {
  const terms = summaries.map((summary) => summary[termKey]);
  const grades = terms.map(getTermPerformanceGrade).filter(hasPerformanceGrade);
  return {
    averagePercentage: grades.length ? grades.reduce((total, grade) => total + grade, 0) / grades.length : null,
    isProvisional: terms.some((term) => hasPerformanceGrade(getTermPerformanceGrade(term)) && term?.performance?.isProvisional),
  };
}

export function getPerformanceStatus(grade) {
  if (!hasPerformanceGrade(grade)) return PERFORMANCE_LEVELS[5];
  return PERFORMANCE_LEVELS.find((level) => level.minimum !== null && grade >= level.minimum);
}

export function buildPerformanceRoster(students, { search = "", level = "ALL", sort = "name" } = {}) {
  const query = search.trim().toLowerCase();
  const matching = students.filter((student) => !query ||
    `${student.name} ${student.grade} ${student.section} ${student.subject_names?.join(" ") ?? ""}`.toLowerCase().includes(query));
  const counts = Object.fromEntries(PERFORMANCE_LEVELS.map(({ label }) => [label, 0]));
  matching.forEach((student) => { counts[getPerformanceStatus(student.averagePercentage).label] += 1; });
  const visible = matching.filter((student) => level === "ALL" || getPerformanceStatus(student.averagePercentage).label === level);
  visible.sort((first, second) => {
    if (sort === "highest" || sort === "lowest") {
      const firstHasGrade = hasPerformanceGrade(first.averagePercentage);
      const secondHasGrade = hasPerformanceGrade(second.averagePercentage);
      // A missing grade stays last and is never treated as a zero score.
      if (firstHasGrade !== secondHasGrade) return firstHasGrade ? -1 : 1;
      if (firstHasGrade) {
        const difference = first.averagePercentage - second.averagePercentage;
        if (difference) return sort === "highest" ? -difference : difference;
      }
    }
    return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" }) || String(first.id).localeCompare(String(second.id));
  });
  return { students: visible, counts, total: matching.length };
}

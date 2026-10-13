import { AsyncLocalStorage } from "node:async_hooks";
export const academicContext = new AsyncLocalStorage();
export const getAcademicContext = () => academicContext.getStore();
export const DEFAULT_RULES = Object.freeze({ passingGrade: 75, highPerformingGrade: 90, writtenWorkWeight: 20, performanceTaskWeight: 50, examinationWeight: 30, requireAllSubjectsPassing: true, requireCompleteScores: true });
export const currentRules = () => ({ ...DEFAULT_RULES, ...getAcademicContext()?.rules });

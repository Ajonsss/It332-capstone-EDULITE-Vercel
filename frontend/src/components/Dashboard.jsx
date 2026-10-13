import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SystemTutorial, { SettingsView } from "./SystemTutorial";
import InterventionsView from "./InterventionsView";
import YearEndView from "./YearEndView";
import AwardsView from "./AwardsView";
import StudentForm from "./StudentForm";
import StudentImport from "./StudentImport";
import ValidatedInput from "./ValidatedInput";
import { parseWholeNumber, validateInput } from "../../../shared/inputValidation.mjs";
import AssessmentForm from "./AssessmentForm";
import RecordPerformanceSummary from "./RecordPerformanceSummary";
import { buildPerformanceRoster, getPerformanceStatus, hasPerformanceGrade, PERFORMANCE_LEVELS } from "../utils/performance";

const API_URL = "http://localhost:3000";

const PAGE_DETAILS = {
  interventions: { title: "Intervention Progress", description: "Assign practice activities and track completion and learning gains." },
  yearEnd: { title: "Year-End & Archives", description: "Review promotion and intervention needs, finish year levels, and revisit archived student records." },
  awards: { title: "Awards & Certificates", description: "Recognize student achievement and improvement with printable certificates." },
  settings: { title: "Settings", description: "Manage your EduLITE preferences and replay the getting-started tutorial." },
  dashboard: {
    title: "Dashboard",
    description:
      "Student performance analytics, learning insights, and subject assessments.",
  },
  records: {
    title: "Student Assessment Records",
    description:
      "Review, edit, and manage student scores for every enrolled subject.",
  },
  sections: {
    title: "Sections",
    description:
      "Create and manage the sections used when registering students.",
  },
  subjects: {
    title: "Subjects",
    description:
      "Create subjects and select the students enrolled in each subject.",
  },
  students: {
    title: "Students",
    description:
      "Register students, manage enrollment, and open individual records.",
  },
  studentForm: {
    title: "Register Student",
    description: "Add or update a student without leaving the dashboard.",
  },
  assessments: {
    title: "Assessments",
    description:
      "Create, review, edit, and manage subject assessments and scores.",
  },
  assessmentForm: {
    title: "Create Assessment",
    description:
      "Create or update an assessment and record scores inside the dashboard.",
  },
  aiInsights: {
    title: "AI Insights",
    description:
      "Generate evidence-based interventions and enrichment activities.",
  },
};

export default function Dashboard() {
  const [activeYearName, setActiveYearName] = useState("Legacy / unassigned records");
  const [gradingRules, setGradingRules] = useState({ passingGrade: 75, highPerformingGrade: 90 });
  const [students, setStudents] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [assessmentRecords, setAssessmentRecords] = useState([]);
  const [gradeSummaries, setGradeSummaries] = useState([]);
  const [selectedSection, setSelectedSection] = useState("ALL");
  const [selectedTerm, setSelectedTerm] = useState("1");
  const [selectedSubject, setSelectedSubject] = useState("ALL");
  const [newSection, setNewSection] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [addingSection, setAddingSection] = useState(false);
  const [addingSubject, setAddingSubject] = useState(false);
  const [showSubjectStudentPrompt, setShowSubjectStudentPrompt] =
    useState(false);
  const [selectedSubjectStudentIds, setSelectedSubjectStudentIds] = useState(
    [],
  );
  const [subjectStudentSearch, setSubjectStudentSearch] = useState("");
  const [toasts, setToasts] = useState([]);
  const toastCounterRef = useRef(0);
  const toastTimersRef = useRef(new Map());
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editedScores, setEditedScores] = useState({});
  const [savingScores, setSavingScores] = useState(false);
  const [tutorialUserId, setTutorialUserId] = useState(null);
  const [tutorialReplayRequest, setTutorialReplayRequest] = useState(0);
  const [activeView, setActiveView] = useState("dashboard");
  const [studentFormId, setStudentFormId] = useState(null);
  const [assessmentFormId, setAssessmentFormId] = useState(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const savedPreference = localStorage.getItem("eduliteSidebarCollapsed");

    if (savedPreference !== null) {
      return savedPreference === "true";
    }

    return typeof window !== "undefined"
      ? window.matchMedia("(max-width: 1023px)").matches
      : true;
  });

  const [interventionDraft, setInterventionDraft] = useState(null);
  const [aiRecommendation, setAiRecommendation] = useState(null);
  const [aiRecommendationError, setAiRecommendationError] = useState("");
  const [generatingRecommendationKey, setGeneratingRecommendationKey] =
    useState("");
  const [expandedStudentId, setExpandedStudentId] = useState(null);
  const [studentInsightsById, setStudentInsightsById] = useState({});
  const [loadingStudentInsightsId, setLoadingStudentInsightsId] =
    useState(null);
  const [studentInsightErrors, setStudentInsightErrors] = useState({});

  const navigate = useNavigate();

  const dismissToast = (toastId) => {
    const existingTimer = toastTimersRef.current.get(toastId);

    if (existingTimer) {
      window.clearTimeout(existingTimer);
      toastTimersRef.current.delete(toastId);
    }

    setToasts((currentToasts) =>
      currentToasts.map((toast) =>
        toast.id === toastId
          ? {
              ...toast,
              closing: true,
            }
          : toast,
      ),
    );

    window.setTimeout(() => {
      setToasts((currentToasts) =>
        currentToasts.filter((toast) => toast.id !== toastId),
      );
    }, 280);
  };

  const showToast = (type, message, options = {}) => {
    const normalizedMessage = String(message ?? "").trim();

    if (!normalizedMessage) {
      return;
    }

    toastCounterRef.current += 1;

    const toastId = `edulite-toast-${Date.now()}-${toastCounterRef.current}`;

    const toast = {
      id: toastId,
      type,
      title:
        options.title ||
        (type === "success"
          ? "EduLITE"
          : type === "error"
            ? "EduLITE"
            : "EduLITE"),
      message: normalizedMessage,
      closing: false,
    };

    setToasts((currentToasts) => [...currentToasts.slice(-2), toast]);

    const duration = Number(options.duration ?? (type === "error" ? 5200 : 4000));

    const timer = window.setTimeout(() => {
      dismissToast(toastId);
    }, duration);

    toastTimersRef.current.set(toastId, timer);
  };

  // Compatibility helpers used throughout the existing Dashboard handlers.
  // Empty strings simply clear the old inline-banner behavior and do not
  // create a notification.
  const setError = (message) => {
    if (message) {
      showToast("error", message);
    }
  };

  const setSuccess = (message) => {
    if (message) {
      showToast("success", message);
    }
  };

  const pageDetails =
    activeView === "studentForm" && studentFormId
      ? {
          title: "Edit Student",
          description:
            "Update the student's information without leaving the dashboard.",
        }
      : activeView === "assessmentForm" && assessmentFormId
        ? {
            title: "Edit Assessment",
            description:
              "Update the assessment and student scores without leaving the dashboard.",
          }
        : (PAGE_DETAILS[activeView] ?? PAGE_DETAILS.dashboard);

  useEffect(() => {
    localStorage.setItem("eduliteSidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => {
        window.clearTimeout(timer);
      });

      timers.clear();
    };
  }, []);

  useEffect(() => {
    const stylesheets = [
      {
        id: "edulite-material-symbols",
        href: "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:FILL@0..1&icon_names=assignment,auto_awesome,category,dashboard,groups,logout,menu_book,table_view&display=block",
      },
    ];

    stylesheets.forEach(({ id, href }) => {
      if (document.getElementById(id)) {
        return;
      }

      const stylesheet = document.createElement("link");
      stylesheet.id = id;
      stylesheet.rel = "stylesheet";
      stylesheet.href = href;
      document.head.appendChild(stylesheet);
    });
  }, []);

  const loadInitialDashboard = useEffectEvent(() => fetchDashboardData());
  useEffect(() => {
    const token = localStorage.getItem("eduliteToken");

    const storedUser = localStorage.getItem("user");

    if (!token || !storedUser) {
      navigate("/");
      return;
    }

    try {
      const user = JSON.parse(storedUser);
      setTutorialUserId(user.id ?? user._id ?? user.name ?? null);
    } catch {
      navigate("/");
      return;
    }

    loadInitialDashboard();
  }, [navigate]);

  const fetchDashboardData = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const [
        studentResponse,
        sectionResponse,
        subjectResponse,
        assessmentResponse,
        recordResponse,
        gradeSummaryResponse,
        schoolYearResponse,
        rulesResponse,
      ] = await Promise.all([
        axios.get(`${API_URL}/students`),
        axios.get(`${API_URL}/sections`),
        axios.get(`${API_URL}/subjects`),
        axios.get(`${API_URL}/assessments`),
        axios.get(`${API_URL}/assessment-records`),
        axios.get(`${API_URL}/grade-summaries`),
        axios.get(`${API_URL}/school-years`),
        axios.get(`${API_URL}/grading-rules`),
      ]);

      setActiveYearName(schoolYearResponse.data.years.find((year) => String(year._id ?? "") === String(schoolYearResponse.data.activeId ?? ""))?.name ?? "School year");
      setGradingRules(rulesResponse.data);
      setStudents(studentResponse.data);
      setSections(sectionResponse.data);
      setSubjects(subjectResponse.data);
      setAssessments(assessmentResponse.data);
      setAssessmentRecords(recordResponse.data);
      setGradeSummaries(gradeSummaryResponse.data ?? []);

      if (
        selectedSection !== "ALL" &&
        !sectionResponse.data.some(
          (section) => section.name === selectedSection,
        )
      ) {
        setSelectedSection("ALL");
      }

      if (
        selectedSubject !== "ALL" &&
        !subjectResponse.data.some(
          (subject) => String(subject.id) === String(selectedSubject),
        )
      ) {
        setSelectedSubject("ALL");
      }
    } catch (err) {
      console.error("Error loading dashboard:", err);

      setError(err.response?.data?.message || "Unable to load the dashboard.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const openView = (view) => {
    if (view !== "studentForm") {
      setStudentFormId(null);
    }

    if (view !== "assessmentForm") {
      setAssessmentFormId(null);
    }

    setActiveView(view);
    setError("");
    setSuccess("");

    if (window.matchMedia("(max-width: 1023px)").matches) {
      setSidebarCollapsed(true);
    }

    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const handleAddSection = async (event) => {
    event.preventDefault();

    const sectionName = newSection.trim();

    const sectionError = validateInput(sectionName, { kind: "section", label: "Section name" });
    if (sectionError) {
      setError(sectionError);
      return;
    }

    setAddingSection(true);
    setError("");
    setSuccess("");

    try {
      await axios.post(`${API_URL}/sections`, {
        name: sectionName,
      });

      setNewSection("");

      await fetchDashboardData({ silent: true });

      setSuccess("Section added successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to add the section.");
    } finally {
      setAddingSection(false);
    }
  };

  const handleRemoveSection = async (section) => {
    if (!window.confirm(`Remove section "${section.name}"?`)) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await axios.delete(`${API_URL}/sections/${section.id}`);

      if (selectedSection === section.name) {
        setSelectedSection("ALL");
      }

      await fetchDashboardData({ silent: true });

      setSuccess("Section removed successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to remove the section.");
    }
  };

  const openSubjectStudentPrompt = (event) => {
    event.preventDefault();

    const subjectError = validateInput(newSubject, { kind: "subject", label: "Subject name" });
    if (subjectError) {
      setError(subjectError);
      return;
    }

    setSelectedSubjectStudentIds([]);
    setSubjectStudentSearch("");
    setError("");
    setSuccess("");
    setShowSubjectStudentPrompt(true);
  };

  const closeSubjectStudentPrompt = () => {
    if (addingSubject) {
      return;
    }

    setShowSubjectStudentPrompt(false);
    setSelectedSubjectStudentIds([]);
    setSubjectStudentSearch("");
  };

  const toggleNewSubjectStudent = (studentId) => {
    setSelectedSubjectStudentIds((currentIds) =>
      currentIds.includes(studentId)
        ? currentIds.filter((id) => id !== studentId)
        : [...currentIds, studentId],
    );
  };

  const handleAddSubject = async () => {
    const subjectName = newSubject.trim();

    const subjectError = validateInput(subjectName, { kind: "subject", label: "Subject name" });
    if (subjectError) {
      setError(subjectError);
      return;
    }

    setAddingSubject(true);
    setError("");
    setSuccess("");

    try {
      const response = await axios.post(`${API_URL}/subjects`, {
        name: subjectName,
        student_ids: selectedSubjectStudentIds,
      });

      const enrolledCount =
        response.data?.student_count ?? selectedSubjectStudentIds.length;

      setNewSubject("");
      setShowSubjectStudentPrompt(false);
      setSelectedSubjectStudentIds([]);
      setSubjectStudentSearch("");

      await fetchDashboardData({ silent: true });

      setSuccess(
        `${
          response.data?.message || "Subject added successfully."
        } ${enrolledCount} student${enrolledCount === 1 ? "" : "s"} enrolled.`,
      );
    } catch (err) {
      setError(err.response?.data?.message || "Unable to add the subject.");
    } finally {
      setAddingSubject(false);
    }
  };

  const handleRenameSubject = async (subject) => {
    const nextName = window
      .prompt("Enter the new subject name:", subject.name)
      ?.trim();

    if (!nextName || nextName === subject.name) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await axios.put(`${API_URL}/subjects/${subject.id}`, {
        name: nextName,
      });

      await fetchDashboardData({ silent: true });

      setSuccess("Subject updated successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to update the subject.");
    }
  };

  const handleRemoveSubject = async (subject) => {
    if (!window.confirm(`Remove subject "${subject.name}"?`)) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await axios.delete(`${API_URL}/subjects/${subject.id}`);

      if (String(selectedSubject) === String(subject.id)) {
        setSelectedSubject("ALL");
      }

      await fetchDashboardData({ silent: true });

      setSuccess("Subject removed successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to remove the subject.");
    }
  };

  const handleDeleteStudent = async (studentId) => {
    if (
      !window.confirm(
        "Remove this student, their scores, learning insights, and intervention records? Issued certificates remain in award history.",
      )
    ) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await axios.delete(`${API_URL}/students/${studentId}`);

      await fetchDashboardData({ silent: true });

      setSuccess("Student deleted successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to delete the student.");
    }
  };

  const handleDeleteAssessment = async (assessmentId) => {
    if (!window.confirm("Delete this assessment and all recorded scores?")) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await axios.delete(`${API_URL}/assessments/${assessmentId}`);

      await fetchDashboardData({ silent: true });

      setSuccess("Assessment deleted successfully.");
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to delete the assessment.",
      );
    }
  };

  const handleRegisterStudent = () => {
    if (sections.length === 0) {
      setError("Add at least one section before registering a student.");
      setActiveView("sections");
      return;
    }

    if (subjects.length === 0) {
      setError("Add at least one subject before registering a student.");
      setActiveView("subjects");
      return;
    }

    setStudentFormId(null);
    openView("studentForm");
  };

  const handleEditStudent = (studentId) => {
    setStudentFormId(studentId);
    setActiveView("studentForm");
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleStudentFormCancel = () => {
    const returnView = "students";
    setStudentFormId(null);
    openView(returnView);
  };

  const handleStudentFormSaved = async (_result, details) => {
    await fetchDashboardData({ silent: true });
    setStudentFormId(null);
    setActiveView("students");
    setError("");
    setSuccess(
      details?.isEditing
        ? "Student updated successfully."
        : "Student registered successfully.",
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleAddAssessment = () => {
    if (subjects.length === 0) {
      setError("Add at least one subject before creating an assessment.");
      setActiveView("subjects");
      return;
    }

    setAssessmentFormId(null);
    openView("assessmentForm");
  };

  const handleEditAssessment = (assessmentId) => {
    setAssessmentFormId(assessmentId);
    setActiveView("assessmentForm");
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleAssessmentFormCancel = () => {
    setAssessmentFormId(null);
    openView("assessments");
  };

  const handleAssessmentFormSaved = async (_result, details) => {
    await fetchDashboardData({ silent: true });
    setAssessmentFormId(null);
    setActiveView("assessments");
    setError("");
    setSuccess(
      details?.isEditing
        ? "Assessment updated successfully."
        : "Assessment added successfully.",
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLogout = () => {
    localStorage.removeItem("eduliteToken");

    localStorage.removeItem("user");

    navigate("/");
  };

  const selectedSubjectId =
    selectedSubject === "ALL" ? null : String(selectedSubject);

  const generateStudentRecommendation = async (student, supportType) => {
    const requestKey = `${supportType}-${student.id}`;

    if (generatingRecommendationKey) {
      return;
    }

    setGeneratingRecommendationKey(requestKey);
    setAiRecommendationError("");
    setAiRecommendation(null);

    try {
      const response = await axios.post(
        `${API_URL}/api/gemini/student-support/${student.id}`,
        {
          support_type: supportType,
          focus_subject_id: selectedSubjectId,
          term: Number(selectedTerm),
        },
      );

      const { savedInsight, ...result } = response.data;

      setAiRecommendation({
        ...result,
        savedInsight,
      });

      if (savedInsight) {
        setStudentInsightsById((current) => {
          if (!Object.prototype.hasOwnProperty.call(current, student.id)) {
            return current;
          }

          return {
            ...current,
            [student.id]: [
              {
                ...savedInsight,
                result,
              },
              ...current[student.id].filter(
                (insight) => insight.id !== savedInsight.id,
              ),
            ],
          };
        });
      }
    } catch (err) {
      console.error("Unable to generate Gemini recommendation:", err);

      setAiRecommendationError(
        err.response?.data?.message ||
          "Unable to generate the learning-support recommendation.",
      );
    } finally {
      setGeneratingRecommendationKey("");
    }
  };

  const closeAiRecommendation = () => {
    if (generatingRecommendationKey) {
      return;
    }

    setAiRecommendation(null);
    setAiRecommendationError("");
  };

  const openSavedInsight = (insight) => {
    if (!insight?.result) {
      setAiRecommendation(null);
      setAiRecommendationError("The saved insight data could not be opened.");
      return;
    }

    setAiRecommendationError("");

    setAiRecommendation({
      ...insight.result,
      savedInsight: {
        id: insight.id,
        studentId: insight.studentId,
        supportType: insight.supportType,
        classification: insight.classification,
        focusSubjectId: insight.focusSubjectId,
        focusLabel: insight.focusLabel,
        model: insight.model,
        title: insight.title,
        createdAt: insight.createdAt,
        pdfUrl: insight.pdfUrl,
      },
    });
  };

  const loadStudentInsights = async (studentId, force = false) => {
    if (
      !force &&
      Object.prototype.hasOwnProperty.call(studentInsightsById, studentId)
    ) {
      return;
    }

    setLoadingStudentInsightsId(studentId);

    setStudentInsightErrors((current) => ({
      ...current,
      [studentId]: "",
    }));

    try {
      const response = await axios.get(
        `${API_URL}/api/students/${studentId}/insights`,
      );

      setStudentInsightsById((current) => ({
        ...current,
        [studentId]: response.data,
      }));
    } catch (err) {
      setStudentInsightErrors((current) => ({
        ...current,
        [studentId]:
          err.response?.data?.message ||
          "Unable to load the student's saved learning insights.",
      }));
    } finally {
      setLoadingStudentInsightsId((currentId) =>
        currentId === studentId ? null : currentId,
      );
    }
  };

  const toggleStudentProfile = async (student) => {
    setExpandedStudentId(student.id);
    await loadStudentInsights(student.id);
  };

  const subjectPromptStudents = useMemo(() => {
    const searchValue = subjectStudentSearch.trim().toLowerCase();

    if (!searchValue) {
      return students;
    }

    return students.filter((student) =>
      `${student.name} ${student.grade} ${student.section}`
        .toLowerCase()
        .includes(searchValue),
    );
  }, [students, subjectStudentSearch]);

  const displayedAssessments = useMemo(() => {
    const subjectFiltered =
      selectedSubjectId === null
        ? assessments
        : assessments.filter(
            (assessment) =>
              assessment.subject_id === selectedSubjectId,
          );

    // Keep legacy assessments visible in the Assessment Library so they
    // can be opened and classified. Official grade views use one term.
    if (activeView === "assessments") {
      return subjectFiltered.filter(
        (assessment) =>
          !assessment.is_structured ||
          Number(assessment.term) === Number(selectedTerm),
      );
    }

    return subjectFiltered.filter(
      (assessment) =>
        Number(assessment.term) === Number(selectedTerm),
    );
  }, [
    assessments,
    selectedSubjectId,
    selectedTerm,
    activeView,
  ]);

  const displayedStudents = useMemo(() => {
    return students.filter((student) => {
      const matchesSection =
        selectedSection === "ALL" || student.section === selectedSection;

      const matchesSubject =
        selectedSubjectId === null ||
        student.subject_ids?.includes(selectedSubjectId);

      return matchesSection && matchesSubject;
    });
  }, [students, selectedSection, selectedSubjectId]);

  const scoreMap = useMemo(() => {
    const map = {};

    for (const record of assessmentRecords) {
      if (!map[record.student_id]) {
        map[record.student_id] = {};
      }

      map[record.student_id][record.assessment_id] = record.score;
    }

    return map;
  }, [assessmentRecords]);

  const getStudentAssessments = (student) =>
    displayedAssessments.filter((assessment) =>
      student.subject_ids?.includes(assessment.subject_id),
    );

  const startEditingScores = (student) => {
    const currentScores = {};

    for (const assessment of getStudentAssessments(student)) {
      const currentScore = scoreMap[student.id]?.[assessment.id];

      currentScores[assessment.id] =
        currentScore === undefined || currentScore === null
          ? ""
          : String(currentScore);
    }

    setEditedScores(currentScores);
    setEditingStudentId(student.id);
    setError("");
    setSuccess("");
  };

  const cancelEditingScores = () => {
    if (savingScores) {
      return;
    }

    setEditingStudentId(null);
    setEditedScores({});
    setError("");
  };

  const handleEditedScoreChange = (assessmentId, value) => {
    if (value !== "" && !/^\d+$/.test(value)) {
      return;
    }

    setEditedScores((currentScores) => ({
      ...currentScores,
      [assessmentId]: value,
    }));
  };

  const saveStudentScores = async (student) => {
    if (savingScores) {
      return;
    }

    setError("");
    setSuccess("");

    const scoreList = [];

    for (const assessment of getStudentAssessments(student)) {
      const enteredValue = editedScores[assessment.id];

      const isBlank =
        enteredValue === "" ||
        enteredValue === null ||
        enteredValue === undefined;

      if (!isBlank) {
        const numericScore = parseWholeNumber(enteredValue);

        if (
          !Number.isInteger(numericScore) ||
          numericScore < 0 ||
          numericScore > Number(assessment.total_items)
        ) {
          setError(
            `${student.name}'s score for "${assessment.name}" must be between 0 and ${assessment.total_items}.`,
          );
          return;
        }
      }

      scoreList.push({
        assessment_id: assessment.id,
        score: isBlank ? null : Number(enteredValue),
      });
    }

    setSavingScores(true);

    try {
      const response = await axios.put(
        `${API_URL}/students/${student.id}/assessment-scores`,
        {
          scores: scoreList,
        },
      );

      setEditingStudentId(null);
      setEditedScores({});

      await fetchDashboardData({ silent: true });

      setSuccess(response.data?.message || "Scores updated successfully.");
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to update the student scores.",
      );
    } finally {
      setSavingScores(false);
    }
  };

  const relevantAssessmentIds = useMemo(
    () =>
      new Set(
        displayedAssessments.map(
          (assessment) => assessment.id,
        ),
      ),
    [displayedAssessments],
  );

  const selectedTermKey = `term${selectedTerm}`;
  const currentTermLabel = `Term ${selectedTerm}`;

  const studentAnalytics = useMemo(() => {
    return displayedStudents.map((student) => {
      const matchingSummaries = gradeSummaries.filter(
        (summary) =>
          summary.student_id === student.id &&
          (selectedSubjectId === null ||
            summary.subject_id === selectedSubjectId),
      );

      const officialTermGrades = matchingSummaries
        .map(
          (summary) =>
            summary[selectedTermKey]?.termGrade,
        )
        .filter(
          (grade) =>
            grade !== null &&
            grade !== undefined &&
            grade !== "" &&
            Number.isFinite(Number(grade)),
        )
        .map(Number);

      const averagePercentage =
        officialTermGrades.length > 0
          ? officialTermGrades.reduce(
              (total, grade) => total + grade,
              0,
            ) / officialTermGrades.length
          : null;

      const assessmentCount = assessmentRecords.filter(
        (record) =>
          record.student_id === student.id &&
          relevantAssessmentIds.has(record.assessment_id),
      ).length;

      return {
        ...student,
        averagePercentage,
        assessmentCount,
        officialTermGrades,
      };
    });
  }, [
    displayedStudents,
    gradeSummaries,
    selectedSubjectId,
    selectedTermKey,
    assessmentRecords,
    relevantAssessmentIds,
  ]);

  const assessedStudents = studentAnalytics.filter(
    (student) => student.averagePercentage !== null,
  );

  const classAverage =
    assessedStudents.length > 0
      ? assessedStudents.reduce(
          (total, student) =>
            total + student.averagePercentage,
          0,
        ) / assessedStudents.length
      : 0;

  const excellentStudents = assessedStudents.filter(
    (student) => student.averagePercentage >= 90,
  );

  const verySatisfactoryStudents = assessedStudents.filter(
    (student) =>
      student.averagePercentage >= 80 &&
      student.averagePercentage < 90,
  );

  const satisfactoryStudents = assessedStudents.filter(
    (student) =>
      student.averagePercentage >= 75 &&
      student.averagePercentage < 80,
  );

  const atRiskStudents = assessedStudents
    .filter(
      (student) =>
        student.averagePercentage < gradingRules.passingGrade,
    )
    .sort(
      (firstStudent, secondStudent) =>
        firstStudent.averagePercentage -
        secondStudent.averagePercentage,
    );

  const highPotentialStudents = assessedStudents
    .filter(
      (student) =>
        student.averagePercentage >=
        gradingRules.highPerformingGrade,
    )
    .sort(
      (firstStudent, secondStudent) =>
        secondStudent.averagePercentage -
        firstStudent.averagePercentage,
    );

  const passingStudents = assessedStudents.filter(
    (student) =>
      student.averagePercentage >= gradingRules.passingGrade,
  );

  const passingRate =
    assessedStudents.length > 0
      ? (passingStudents.length / assessedStudents.length) * 100
      : 0;

  const currentSectionLabel =
    selectedSection === "ALL"
      ? "All Sections"
      : selectedSection;

  const currentSubject = subjects.find(
    (subject) =>
      String(subject.id) === String(selectedSubject),
  );

  const currentSubjectLabel =
    selectedSubject === "ALL"
      ? "All Subjects"
      : currentSubject?.name || "Selected Subject";

  const getPercentage = (count) =>
    assessedStudents.length === 0
      ? 0
      : (count / assessedStudents.length) * 100;

  return (
    <div
      className="edulite-shell min-h-screen bg-[var(--ed-color-f4f7fa)] text-[var(--ed-color-25313c)]"
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
      }}
    >
      <style>{`
        .edulite-shell * {
          box-sizing: border-box;
        }

        .edulite-shell button,
        .edulite-shell input,
        .edulite-shell select,
        .edulite-shell textarea {
          font: inherit;
        }

        .edulite-shell button,
        .edulite-shell [role="button"] {
          transition:
            background-color 160ms ease,
            border-color 160ms ease,
            color 160ms ease,
            transform 160ms ease,
            box-shadow 160ms ease;
        }

        .edulite-shell button:not(:disabled):active,
        .edulite-shell [role="button"]:active {
          transform: scale(0.98);
        }

        .edulite-shell :where(button, input, select, textarea, a):focus-visible {
          outline: 3px solid rgba(54, 169, 225, 0.28);
          outline-offset: 2px;
        }

        .edulite-shell input,
        .edulite-shell select,
        .edulite-shell textarea {
          min-height: 44px;
        }

        .edulite-shell select option {
          color: var(--ed-text);
          background: var(--ed-surface);
        }

        .minimal-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: var(--ed-border) transparent;
        }

        .minimal-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .minimal-scrollbar::-webkit-scrollbar-thumb {
          background: var(--ed-border);
          border-radius: 999px;
        }

        @keyframes mac-notification-in {
          from {
            opacity: 0;
            transform: translate3d(28px, -8px, 0) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }

        @keyframes mac-notification-out {
          from {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
          to {
            opacity: 0;
            transform: translate3d(24px, -4px, 0) scale(0.98);
          }
        }

        .mac-notification-card {
          animation: mac-notification-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
          -webkit-backdrop-filter: blur(28px) saturate(170%);
          backdrop-filter: blur(28px) saturate(170%);
        }

        .mac-notification-card[data-closing="true"] {
          animation: mac-notification-out 260ms ease both;
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .edulite-shell *,
          .edulite-shell *::before,
          .edulite-shell *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <aside
        aria-label="EduLITE navigation"
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] transition-[width] duration-200 ${
          sidebarCollapsed ? "w-[68px]" : "w-[220px]"
        }`}
      >
        <div className="flex h-[76px] items-center border-b border-[var(--ed-color-eef2f5)] px-3">
          <button
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            className={`flex w-full items-center rounded-[14px] px-2 py-2 text-left hover:bg-[var(--ed-color-f4f7fa)] ${
              sidebarCollapsed ? "justify-center" : "gap-3"
            }`}
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ed-primary)] text-lg font-black text-white">
              EL
            </div>

            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-[16px] font-bold text-[var(--ed-color-25313c)]">
                  EduLITE
                </p>
                <p className="truncate text-[11px] text-[var(--ed-color-8a98a5)]">
                  Teacher Suite
                </p>
              </div>
            )}
          </button>
        </div>

        <nav className="minimal-scrollbar flex-1 overflow-y-auto px-2 py-4">
          <div className="space-y-1.5">
            <SidebarButton
              active={activeView === "dashboard"}
              label="Dashboard"
              icon="dashboard"
              collapsed={sidebarCollapsed}
              onClick={() => openView("dashboard")}
            />
            <SidebarButton
              active={activeView === "sections"}
              label="Sections"
              icon="category"
              collapsed={sidebarCollapsed}
              onClick={() => openView("sections")}
            />
            <SidebarButton
              active={activeView === "subjects"}
              label="Subjects"
              icon="menu_book"
              collapsed={sidebarCollapsed}
              onClick={() => openView("subjects")}
            />
            <SidebarButton
              active={activeView === "students" || activeView === "studentForm"}
              label="Students"
              icon="groups"
              collapsed={sidebarCollapsed}
              onClick={() => openView("students")}
            />
            <SidebarButton
              active={activeView === "assessments" || activeView === "assessmentForm"}
              label="Assessments"
              icon="assignment"
              collapsed={sidebarCollapsed}
              onClick={() => openView("assessments")}
            />
            <SidebarButton
              active={activeView === "records"}
              label="Records"
              icon="table_view"
              collapsed={sidebarCollapsed}
              onClick={() => openView("records")}
            />
            <SidebarButton
              active={activeView === "interventions"}
              label="Interventions"
              icon="intervention"
              collapsed={sidebarCollapsed}
              onClick={() => openView("interventions")}
            />
            <SidebarButton
              active={activeView === "yearEnd"}
              label="Year-End & Archives"
              icon="archive"
              collapsed={sidebarCollapsed}
              onClick={() => openView("yearEnd")}
            />
            <SidebarButton
              active={activeView === "awards"}
              label="Awards"
              icon="workspace_premium"
              collapsed={sidebarCollapsed}
              onClick={() => openView("awards")}
            />
            <SidebarButton
              active={activeView === "aiInsights"}
              label="AI Insights"
              icon="auto_awesome"
              collapsed={sidebarCollapsed}
              onClick={() => openView("aiInsights")}
            />
          </div>
        </nav>

        <div className="space-y-2 border-t border-[var(--ed-color-eef2f5)] p-3">
          <SidebarButton
            active={activeView === "settings"}
            label="Settings"
            icon="settings"
            description="Appearance & help"
            collapsed={sidebarCollapsed}
            onClick={() => openView("settings")}
          />
          <SidebarButton
            label="Logout"
            icon="logout"
            collapsed={sidebarCollapsed}
            danger
            onClick={handleLogout}
          />
        </div>
      </aside>

      <div
        className={`min-h-screen transition-[padding] duration-200 ${
          sidebarCollapsed ? "pl-[68px]" : "pl-[68px] lg:pl-[220px]"
        }`}
      >
        <header className="px-5 pt-8 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-[1500px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ed-primary)]">
              EduLITE
            </p>
            <p className="mt-1 text-xs font-semibold text-[var(--ed-muted)]">School year: {activeYearName}</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.04em] text-[var(--ed-primary)] sm:text-5xl">
              {pageDetails.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ed-color-71808d)] sm:text-base">
              {pageDetails.description}
            </p>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1560px] px-5 pb-12 pt-7 sm:px-8 lg:px-10">
          {loading ? (
            <div className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] px-8 py-16 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--ed-color-dceaf2)] border-t-[var(--ed-primary)]" />
              <p className="mt-4 text-sm text-[var(--ed-color-71808d)]">Loading EduLITE...</p>
            </div>
          ) : (
            <>
              {activeView === "interventions" && <InterventionsView students={students} initialDraft={interventionDraft} />}
              {activeView === "yearEnd" && (
                <YearEndView onFinished={() => fetchDashboardData({ silent: true })} onOpenInsight={openSavedInsight} />
              )}

              {activeView === "awards" && (
                <AwardsView persistHistory students={students} sections={sections} subjects={subjects} gradeSummaries={gradeSummaries} />
              )}

              {activeView === "settings" && (
                <SettingsView teacherTools onReplayTutorial={() => setTutorialReplayRequest((current) => current + 1)} />
              )}

              {activeView === "dashboard" && (
                <DashboardView
                  students={students}
                  sections={sections}
                  subjects={subjects}
                  assessments={assessments}
                  displayedAssessments={displayedAssessments}
                  selectedSection={selectedSection}
                  selectedSubject={selectedSubject}
                  selectedTerm={selectedTerm}
                  setSelectedSection={setSelectedSection}
                  setSelectedSubject={setSelectedSubject}
                  setSelectedTerm={setSelectedTerm}
                  currentSectionLabel={currentSectionLabel}
                  currentSubjectLabel={currentSubjectLabel}
                  classAverage={classAverage}
                  assessedStudents={assessedStudents}
                  displayedStudents={displayedStudents}
                  passingRate={passingRate}
                  passingStudents={passingStudents}
                  atRiskStudents={atRiskStudents}
                  excellentStudents={excellentStudents}
                  verySatisfactoryStudents={verySatisfactoryStudents}
                  satisfactoryStudents={satisfactoryStudents}
                  highPotentialStudents={highPotentialStudents}
                  getPercentage={getPercentage}
                  onEditAssessment={handleEditAssessment}
                  handleDeleteAssessment={handleDeleteAssessment}
                  generateStudentRecommendation={generateStudentRecommendation}
                  generatingRecommendationKey={generatingRecommendationKey}
                  gradingRules={gradingRules}
                  openView={openView}
                  handleRegisterStudent={handleRegisterStudent}
                  handleAddAssessment={handleAddAssessment}
                />
              )}

              {activeView === "students" && (
                <StudentsView
                  students={students}
                  sections={sections}
                  subjects={subjects}
                  onAddStudent={handleRegisterStudent}
                  onImported={() => fetchDashboardData({ silent: true })}
                  onEditStudent={handleEditStudent}
                  onDeleteStudent={handleDeleteStudent}
                  onOpenRecords={(student) => {
                    setSelectedSection(student.section);
                    setSelectedSubject("ALL");
                    openView("records");
                  }}
                />
              )}

              {activeView === "records" && (
                <RecordsView
                  students={students}
                  sections={sections}
                  subjects={subjects}
                  assessments={assessments}
                  displayedAssessments={displayedAssessments}
                  studentAnalytics={studentAnalytics}
                  selectedSection={selectedSection}
                  selectedSubject={selectedSubject}
                  selectedTerm={selectedTerm}
                  setSelectedSection={setSelectedSection}
                  setSelectedSubject={setSelectedSubject}
                  setSelectedTerm={setSelectedTerm}
                  currentSectionLabel={currentSectionLabel}
                  currentSubjectLabel={currentSubjectLabel}
                  currentTermLabel={currentTermLabel}
                  scoreMap={scoreMap}
                  editingStudentId={editingStudentId}
                  editedScores={editedScores}
                  savingScores={savingScores}
                  getPerformanceStatus={getPerformanceStatus}
                  handleEditedScoreChange={handleEditedScoreChange}
                  startEditingScores={startEditingScores}
                  cancelEditingScores={cancelEditingScores}
                  saveStudentScores={saveStudentScores}
                  getStudentAssessments={getStudentAssessments}
                  onEditStudent={handleEditStudent}
                  handleDeleteStudent={handleDeleteStudent}
                  assessmentRecords={assessmentRecords}
                  gradeSummaries={gradeSummaries}
                  expandedStudentId={expandedStudentId}
                  toggleStudentProfile={toggleStudentProfile}
                  studentInsightsById={studentInsightsById}
                  loadingStudentInsightsId={loadingStudentInsightsId}
                  studentInsightErrors={studentInsightErrors}
                  openSavedInsight={openSavedInsight}
                  reloadStudentInsights={loadStudentInsights}
                />
              )}

              {activeView === "sections" && (
                <SectionManagementView
                  sections={sections}
                  newSection={newSection}
                  setNewSection={setNewSection}
                  addingSection={addingSection}
                  handleAddSection={handleAddSection}
                  handleRemoveSection={handleRemoveSection}
                  openDashboardForSection={(sectionName) => {
                    setSelectedSection(sectionName);
                    openView("dashboard");
                  }}
                />
              )}

              {activeView === "subjects" && (
                <SubjectManagementView
                  subjects={subjects}
                  newSubject={newSubject}
                  setNewSubject={setNewSubject}
                  addingSubject={addingSubject}
                  openSubjectStudentPrompt={openSubjectStudentPrompt}
                  handleRenameSubject={handleRenameSubject}
                  handleRemoveSubject={handleRemoveSubject}
                  openDashboardForSubject={(subjectId) => {
                    setSelectedSubject(String(subjectId));
                    openView("dashboard");
                  }}
                />
              )}

              {activeView === "assessments" && (
                <AssessmentsView
                  students={students}
                  sections={sections}
                  subjects={subjects}
                  assessments={assessments}
                  displayedAssessments={displayedAssessments}
                  selectedSection={selectedSection}
                  selectedSubject={selectedSubject}
                  selectedTerm={selectedTerm}
                  setSelectedSection={setSelectedSection}
                  setSelectedSubject={setSelectedSubject}
                  setSelectedTerm={setSelectedTerm}
                  currentSubjectLabel={currentSubjectLabel}
                  onAddAssessment={handleAddAssessment}
                  onEditAssessment={handleEditAssessment}
                  onDeleteAssessment={handleDeleteAssessment}
                />
              )}

              {activeView === "aiInsights" && (
                <AiInsightsView
                  students={students}
                  sections={sections}
                  subjects={subjects}
                  assessments={assessments}
                  selectedSection={selectedSection}
                  selectedSubject={selectedSubject}
                  selectedTerm={selectedTerm}
                  setSelectedSection={setSelectedSection}
                  setSelectedSubject={setSelectedSubject}
                  setSelectedTerm={setSelectedTerm}
                  currentSectionLabel={currentSectionLabel}
                  currentSubjectLabel={currentSubjectLabel}
                  currentTermLabel={currentTermLabel}
                  atRiskStudents={atRiskStudents}
                  highPotentialStudents={highPotentialStudents}
                  gradingRules={gradingRules}
                  generateStudentRecommendation={generateStudentRecommendation}
                  generatingRecommendationKey={generatingRecommendationKey}
                />
              )}

              {activeView === "studentForm" && (
                <StudentForm
                  embedded
                  studentId={studentFormId}
                  onCancel={handleStudentFormCancel}
                  onSaved={handleStudentFormSaved}
                />
              )}

              {activeView === "assessmentForm" && (
                <AssessmentForm
                  embedded
                  assessmentId={assessmentFormId}
                  onCancel={handleAssessmentFormCancel}
                  onSaved={handleAssessmentFormSaved}
                />
              )}
            </>
          )}
        </main>
      </div>

      {showSubjectStudentPrompt && (
        <SubjectEnrollmentModal
          subjectName={newSubject.trim()}
          students={students}
          filteredStudents={subjectPromptStudents}
          searchValue={subjectStudentSearch}
          setSearchValue={setSubjectStudentSearch}
          selectedIds={selectedSubjectStudentIds}
          setSelectedIds={setSelectedSubjectStudentIds}
          toggleStudent={toggleNewSubjectStudent}
          addingSubject={addingSubject}
          closeModal={closeSubjectStudentPrompt}
          createSubject={handleAddSubject}
        />
      )}

      {(aiRecommendation || aiRecommendationError) && (
        <AiRecommendationModal
          recommendation={aiRecommendation}
          error={aiRecommendationError}
          closeModal={closeAiRecommendation}
          onAssignActivity={(activity) => {
            setInterventionDraft({ studentId: aiRecommendation?.student?.id ?? "", title: activity.title, difficulty: activity.difficulty, activities: [...(activity.instructions ?? []), ...(activity.tasks ?? [])].join("\n"), notes: `Mastery check: ${activity.masteryCheck ?? ""}` });
            closeAiRecommendation(); openView("interventions");
          }}
        />
      )}

      {!loading && tutorialUserId && (
        <SystemTutorial userId={tutorialUserId} replayRequest={tutorialReplayRequest} />
      )}

      <MacNotificationCenter toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function MacNotificationCenter({ toasts, onDismiss }) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(390px,calc(100vw-32px))] flex-col gap-2.5 sm:right-6 sm:top-6">
      {toasts.map((toast) => {
        const isError = toast.type === "error";

        return (
          <div
            key={toast.id}
            data-closing={toast.closing ? "true" : "false"}
            className="mac-notification-card pointer-events-auto overflow-hidden rounded-[20px] border border-white/70 bg-[var(--ed-surface)]/82 shadow-[0_18px_48px_rgba(30,46,58,0.18)]"
          >
            <div className="flex gap-3 p-4">
              <div
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-sm font-bold text-white ${
                  isError ? "bg-[#ff4d4f]" : "bg-[var(--ed-primary)]"
                }`}
              >
                {isError ? "!" : "EL"}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ed-color-25313c)]">
                      {toast.title || "EduLITE"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--ed-color-8a98a5)]">
                      {isError ? "Action needs attention" : "Update completed"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDismiss(toast.id)}
                    className="flex h-7 w-7 !min-h-0 items-center justify-center rounded-full text-lg leading-none text-[var(--ed-color-8a98a5)] hover:bg-[var(--ed-color-eef2f5)] hover:text-[var(--ed-color-25313c)]"
                    aria-label="Dismiss notification"
                  >
                    ×
                  </button>
                </div>

                <p className="mt-2 text-sm leading-5 text-[var(--ed-color-52616d)]">
                  {toast.message}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DashboardView({
  students,
  sections,
  subjects,
  assessments,
  displayedAssessments,
  selectedSection,
  selectedSubject,
  selectedTerm,
  setSelectedSection,
  setSelectedSubject,
  setSelectedTerm,
  currentSectionLabel,
  currentSubjectLabel,
  classAverage,
  assessedStudents,
  displayedStudents,
  passingRate,
  passingStudents,
  atRiskStudents,
  excellentStudents,
  verySatisfactoryStudents,
  satisfactoryStudents,
  highPotentialStudents,
  getPercentage,
  onEditAssessment,
  handleDeleteAssessment,
  generateStudentRecommendation,
  generatingRecommendationKey,
  gradingRules = { passingGrade: 75, highPerformingGrade: 90 },
  openView,
  handleAddAssessment,
}) {
  const belowConnecting = assessedStudents.filter((student) => student.averagePercentage < 75);
  const distribution = [
    {
      label: "Advancing",
      count: excellentStudents.length,
      percentage: getPercentage(excellentStudents.length),
    },
    {
      label: "Benchmarking",
      count: verySatisfactoryStudents.length,
      percentage: getPercentage(verySatisfactoryStudents.length),
    },
    {
      label: "Connecting",
      count: satisfactoryStudents.length,
      percentage: getPercentage(satisfactoryStudents.length),
    },
    {
      label: "Developing / Emerging",
      count: belowConnecting.length,
      percentage: getPercentage(belowConnecting.length),
    },
  ];

  const recentAssessments = [...displayedAssessments]
    .sort((first, second) => String(second.date).localeCompare(String(first.date)))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <DashboardFilters
        students={students}
        sections={sections}
        subjects={subjects}
        assessments={assessments}
        selectedSection={selectedSection}
        selectedSubject={selectedSubject}
        selectedTerm={selectedTerm}
        setSelectedSection={setSelectedSection}
        setSelectedSubject={setSelectedSubject}
        setSelectedTerm={setSelectedTerm}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MinimalMetric
          label="Class Average"
          value={classAverage.toFixed(1)}
          detail={`${currentSectionLabel} · ${currentSubjectLabel} · Term ${selectedTerm}`}
        />
        <MinimalMetric
          label="Passing Rate"
          value={`${passingRate.toFixed(1)}%`}
          detail={`${passingStudents.length} of ${assessedStudents.length} assessed learners`}
        />
        <MinimalMetric
          label="Students Assessed"
          value={assessedStudents.length}
          detail={`${displayedStudents.length} students match the filters`}
        />
        <MinimalMetric
          label="Needs Support"
          value={atRiskStudents.length}
          detail={`Below ${gradingRules.passingGrade} in Term ${selectedTerm}`}
          attention={atRiskStudents.length > 0}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
                Performance
              </p>
              <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">
                Student Distribution
              </h2>
            </div>
            <span className="text-sm text-[var(--ed-color-8a98a5)]">
              {assessedStudents.length} assessed
            </span>
          </div>

          <div className="mt-6 space-y-5">
            {distribution.map((item) => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--ed-color-52616d)]">{item.label}</span>
                  <span className="text-[var(--ed-color-8a98a5)]">
                    {item.count} · {item.percentage.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--ed-color-edf2f5)]">
                  <div
                    className="h-full rounded-full bg-[var(--ed-primary)]"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
                Priorities
              </p>
              <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">
                Learning Support
              </h2>
            </div>
            <button
              type="button"
              onClick={() => openView("aiInsights")}
              className="text-sm font-semibold text-[var(--ed-color-168cc8)] hover:text-[var(--ed-color-0f77aa)]"
            >
              View all
            </button>
          </div>

          <div className="mt-6 space-y-3">
            <PriorityStudent
              label="Needs intervention"
              student={atRiskStudents[0]}
              term={selectedTerm}
              supportType="intervention"
              onGenerate={generateStudentRecommendation}
              generatingKey={generatingRecommendationKey}
            />
            <PriorityStudent
              label="Ready for enrichment"
              student={highPotentialStudents[0]}
              term={selectedTerm}
              supportType="enrichment"
              onGenerate={generateStudentRecommendation}
              generatingKey={generatingRecommendationKey}
            />
          </div>
        </section>
      </div>

      <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
              Recent Activity
            </p>
            <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">
              Assessments
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => openView("assessments")}
              className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)] hover:border-[var(--ed-primary)] hover:text-[var(--ed-color-168cc8)]"
            >
              View library
            </button>
            <button
              type="button"
              onClick={handleAddAssessment}
              className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]"
            >
              New assessment
            </button>
          </div>
        </div>

        <div className="mt-5 divide-y divide-[var(--ed-color-eef2f5)]">
          {recentAssessments.map((assessment) => (
            <div
              key={assessment.id}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--ed-color-25313c)]">
                  {assessment.name}
                </p>
                <p className="mt-1 text-sm text-[var(--ed-color-8a98a5)]">
                  {assessment.subject_name} · {assessment.slot_label ?? assessment.category_label ?? assessment.type} · {assessment.date}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => onEditAssessment(assessment.id)}
                  className="text-[var(--ed-color-168cc8)] hover:text-[var(--ed-color-0f77aa)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteAssessment(assessment.id)}
                  className="text-[var(--ed-color-d94141)] hover:text-[var(--ed-color-b82e2e)]"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {recentAssessments.length === 0 && (
            <EmptyState
              title="No assessments yet"
              description="Create an assessment to begin recording student performance."
              actionLabel="Create assessment"
              onAction={handleAddAssessment}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function MinimalMetric({ label, value, detail, attention = false }) {
  return (
    <div className="rounded-[22px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ed-color-8a98a5)]">
        {label}
      </p>
      <p
        className={`mt-4 text-4xl font-extrabold tracking-[-0.04em] ${
          attention ? "text-[var(--ed-color-d94141)]" : "text-[var(--ed-primary)]"
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-[var(--ed-color-71808d)]">{detail}</p>
    </div>
  );
}

function PriorityStudent({
  label,
  student,
  term,
  supportType,
  onGenerate,
  generatingKey,
}) {
  const requestKey = student ? `${supportType}-${student.id}` : "";
  const isGenerating = generatingKey === requestKey;

  return (
    <div className="rounded-[18px] border border-[var(--ed-color-e7edf1)] bg-[var(--ed-color-f8fafb)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">
        {label}
      </p>
      {student ? (
        <div className="mt-2 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--ed-color-25313c)]">{student.name}</p>
            <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">
              Term {term}: {student.averagePercentage.toFixed(1)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onGenerate(student, supportType)}
            disabled={Boolean(generatingKey)}
            className="shrink-0 rounded-[11px] bg-[var(--ed-primary)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:opacity-50"
          >
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--ed-color-8a98a5)]">No student identified.</p>
      )}
    </div>
  );
}

function StudentsView({
  students,
  sections,
  subjects,
  onAddStudent,
  onImported,
  onEditStudent,
  onDeleteStudent,
  onOpenRecords,
}) {
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("ALL");

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return students.filter((student) => {
      const matchesSection =
        sectionFilter === "ALL" || student.section === sectionFilter;
      const matchesSearch =
        !query ||
        `${student.name} ${student.grade} ${student.section} ${
          student.subjects?.map((subject) => subject.name).join(" ") || ""
        }`
          .toLowerCase()
          .includes(query);

      return matchesSection && matchesSearch;
    });
  }, [students, search, sectionFilter]);

  return (
    <div className="space-y-6">
      <StudentImport subjects={subjects} onImported={onImported} />
      <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
              Student Directory
            </p>
            <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">
              {students.length} registered student{students.length === 1 ? "" : "s"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onAddStudent}
            className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]"
          >
            Register student
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_240px]">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, grade, section, or subject"
            className="rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
          />
          <select
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            className="rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
          >
            <option value="ALL">All Sections</option>
            {sections.map((section) => (
              <option key={section.id} value={section.name}>
                {section.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
        <div className="minimal-scrollbar overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead className="bg-[var(--ed-color-f8fafb)]">
              <tr className="border-b border-[var(--ed-color-e3e9ee)]">
                <TableHeading>Student</TableHeading>
                <TableHeading align="center">Grade</TableHeading>
                <TableHeading align="center">Section</TableHeading>
                <TableHeading>Subjects</TableHeading>
                <TableHeading align="right">Actions</TableHeading>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
              {filteredStudents.map((student) => (
                <tr key={student.id} className="hover:bg-[var(--ed-color-fbfcfd)]">
                  <td className="px-5 py-4 font-semibold text-[var(--ed-color-25313c)]">
                    {student.name}
                  </td>
                  <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">
                    {student.grade}
                  </td>
                  <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">
                    {student.section}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {student.subjects?.map((subject) => (
                        <span
                          key={subject.id}
                          className="rounded-full bg-[var(--ed-color-eaf6fc)] px-2.5 py-1 text-xs font-medium text-[var(--ed-color-168cc8)]"
                        >
                          {subject.name}
                        </span>
                      ))}
                      {!student.subjects?.length && (
                        <span className="text-sm text-[var(--ed-color-a0abb4)]">No subjects</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-3 text-sm font-semibold">
                      <button
                        type="button"
                        onClick={() => onOpenRecords(student)}
                        className="text-[var(--ed-color-168cc8)] hover:text-[var(--ed-color-0f77aa)]"
                      >
                        Records
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditStudent(student.id)}
                        className="text-[var(--ed-color-52616d)] hover:text-[var(--ed-color-25313c)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteStudent(student.id)}
                        className="text-[var(--ed-color-d94141)] hover:text-[var(--ed-color-b82e2e)]"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-6 py-16 text-center text-sm text-[var(--ed-color-8a98a5)]">
                    {students.length === 0
                      ? "No students registered yet."
                      : "No students match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {subjects.length === 0 && students.length > 0 && (
        <p className="rounded-[16px] border border-[var(--ed-color-f1d58b)] bg-[var(--ed-color-fff9e8)] p-4 text-sm text-[var(--ed-color-8a6a12)]">
          Create at least one subject to complete student enrollment.
        </p>
      )}
    </div>
  );
}

function AssessmentsView({
  students,
  sections,
  subjects,
  assessments,
  displayedAssessments,
  selectedSection,
  selectedSubject,
  selectedTerm,
  setSelectedSection,
  setSelectedSubject,
  setSelectedTerm,
  currentSubjectLabel,
  onAddAssessment,
  onEditAssessment,
  onDeleteAssessment,
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
              Assessment Library
            </p>
            <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">
              {displayedAssessments.length} assessment{displayedAssessments.length === 1 ? "" : "s"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onAddAssessment}
            className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]"
          >
            Create assessment
          </button>
        </div>
      </section>

      <DashboardFilters
        students={students}
        sections={sections}
        subjects={subjects}
        assessments={assessments}
        selectedSection={selectedSection}
        selectedSubject={selectedSubject}
        selectedTerm={selectedTerm}
        setSelectedSection={setSelectedSection}
        setSelectedSubject={setSelectedSubject}
        setSelectedTerm={setSelectedTerm}
      />

      <AssessmentList
        displayedAssessments={displayedAssessments}
        currentSubjectLabel={currentSubjectLabel}
        onEditAssessment={onEditAssessment}
        handleDeleteAssessment={onDeleteAssessment}
      />
    </div>
  );
}

function AiInsightsView({
  students,
  sections,
  subjects,
  assessments,
  selectedSection,
  selectedSubject,
  selectedTerm,
  setSelectedSection,
  setSelectedSubject,
  setSelectedTerm,
  currentSectionLabel,
  currentSubjectLabel,
  currentTermLabel,
  atRiskStudents,
  highPotentialStudents,
  gradingRules = { passingGrade: 75, highPerformingGrade: 90 },
  generateStudentRecommendation,
  generatingRecommendationKey,
}) {
  return (
    <div className="space-y-6">
      <DashboardFilters
        students={students}
        sections={sections}
        subjects={subjects}
        assessments={assessments}
        selectedSection={selectedSection}
        selectedSubject={selectedSubject}
        selectedTerm={selectedTerm}
        setSelectedSection={setSelectedSection}
        setSelectedSubject={setSelectedSubject}
        setSelectedTerm={setSelectedTerm}
      />

      <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
          Current Evidence Set
        </p>
        <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">
          {currentSubjectLabel} · {currentSectionLabel} · {currentTermLabel}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ed-color-71808d)]">
          Generate teacher-reviewed interventions for learners below {gradingRules.passingGrade} and enrichment recommendations for learners at {gradingRules.highPerformingGrade} or above.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InsightList
          title="Needs Intervention"
          description="Students currently below the expected range."
          students={atRiskStudents}
          type="risk"
          onGenerateRecommendation={generateStudentRecommendation}
          generatingRecommendationKey={generatingRecommendationKey}
        />
        <InsightList
          title="Ready for Enrichment"
          description={`Students currently performing at ${gradingRules.highPerformingGrade} or above.`}
          students={highPotentialStudents}
          type="potential"
          onGenerateRecommendation={generateStudentRecommendation}
          generatingRecommendationKey={generatingRecommendationKey}
        />
      </div>
    </div>
  );
}

export function RecordsView({
  sections,
  subjects,
  assessments,
  studentAnalytics,
  selectedSection,
  selectedSubject,
  selectedTerm,
  setSelectedSection,
  setSelectedSubject,
  setSelectedTerm,
  currentSectionLabel,
  currentSubjectLabel,
  currentTermLabel,
  scoreMap,
  editingStudentId,
  editedScores,
  savingScores,
  getPerformanceStatus,
  handleEditedScoreChange,
  startEditingScores,
  cancelEditingScores,
  saveStudentScores,
  getStudentAssessments,
  onEditStudent,
  assessmentRecords,
  gradeSummaries,
  expandedStudentId,
  toggleStudentProfile,
  studentInsightsById,
  loadingStudentInsightsId,
  studentInsightErrors,
  openSavedInsight,
  reloadStudentInsights,
}) {
  const [studentSearch, setStudentSearch] = useState("");
  const [detailTab, setDetailTab] = useState("current");
  const [performanceLevel, setPerformanceLevel] = useState("ALL");
  const [studentSort, setStudentSort] = useState("name");
  const filtersLocked = Boolean(editingStudentId) || savingScores;

  const roster = useMemo(() => buildPerformanceRoster(studentAnalytics, {
    search: studentSearch, level: performanceLevel, sort: studentSort,
  }), [studentAnalytics, studentSearch, performanceLevel, studentSort]);
  const filteredStudents = roster.students;

  useEffect(() => {
    if (filteredStudents.length === 0 || filtersLocked) {
      return;
    }

    const selectedStudentStillExists = filteredStudents.some(
      (student) => student.id === expandedStudentId,
    );

    if (!selectedStudentStillExists) {
      toggleStudentProfile(filteredStudents[0]);
    }
  }, [filteredStudents, expandedStudentId, filtersLocked, toggleStudentProfile]);

  const selectedStudent =
    filteredStudents.find((student) => student.id === expandedStudentId) ??
    filteredStudents[0] ??
    null;

  const selectedStatus = selectedStudent
    ? getPerformanceStatus(selectedStudent.averagePercentage)
    : getPerformanceStatus(null);

  const selectedStudentAssessments = selectedStudent
    ? getStudentAssessments(selectedStudent)
    : [];

  const selectedStudentRecords = selectedStudent
    ? assessments
        .filter((assessment) =>
          selectedStudent.subject_ids?.includes(assessment.subject_id),
        )
        .map((assessment) => {
          const record = assessmentRecords.find(
            (item) =>
              item.student_id === selectedStudent.id &&
              item.assessment_id === assessment.id,
          );

          return {
            id: record?.id ?? `missing-${selectedStudent.id}-${assessment.id}`,
            student_id: selectedStudent.id,
            assessment_id: assessment.id,
            assessment_name: assessment.name,
            subject_id: assessment.subject_id,
            subject_name: assessment.subject_name,
            type: assessment.category_label ?? assessment.type,
            term: assessment.term,
            term_label: assessment.term_label,
            category: assessment.category,
            category_label: assessment.category_label,
            sequence: assessment.sequence,
            slot_label: assessment.slot_label,
            date: assessment.date,
            total_items: assessment.total_items,
            score: record?.score ?? null,
          };
        })
        .sort((first, second) => {
          const termComparison = Number(first.term ?? 99) - Number(second.term ?? 99);
          if (termComparison !== 0) return termComparison;
          return String(second.date).localeCompare(String(first.date));
        })
    : [];

  const selectedGradeSummaries = selectedStudent
    ? gradeSummaries.filter((summary) => summary.student_id === selectedStudent.id)
    : [];

  const selectedInsights = selectedStudent
    ? studentInsightsById[selectedStudent.id] ?? []
    : [];

  const selectedInsightsLoading = selectedStudent
    ? loadingStudentInsightsId === selectedStudent.id
    : false;

  const selectedInsightError = selectedStudent
    ? studentInsightErrors[selectedStudent.id] || ""
    : "";

  const selectedIsEditing = selectedStudent
    ? editingStudentId === selectedStudent.id
    : false;

  const handleSelectStudent = async (student) => {
    if (expandedStudentId === student.id) return;
    if (editingStudentId && editingStudentId !== student.id) {
      cancelEditingScores();
    }
    setDetailTab("current");
    await toggleStudentProfile(student);
  };

  return (
    <div className="space-y-5">
      <RecordPerformanceSummary
        counts={roster.counts} total={roster.total} shown={filteredStudents.length}
        level={performanceLevel} onLevelChange={setPerformanceLevel} disabled={filtersLocked}
        context={`${currentSectionLabel} · ${currentSubjectLabel} · ${currentTermLabel}${studentSearch.trim() ? " · Search results" : ""}`}
      />
      <div className="grid min-h-[calc(100vh-350px)] grid-cols-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <section className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
          <div className="border-b border-[var(--ed-color-eef2f5)] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
              Learners
            </p>
            <h2 className="mt-2 text-xl font-bold text-[var(--ed-color-25313c)]">Student List</h2>
            <p className="mt-1 text-xs text-[var(--ed-color-71808d)]">{filteredStudents.length} student{filteredStudents.length === 1 ? "" : "s"}{performanceLevel !== "ALL" ? ` · ${performanceLevel}` : ""}</p>

            <div className="mt-5 space-y-2.5">
              <select
                value={selectedSection}
                aria-label="Filter records by section"
                disabled={filtersLocked}
                onChange={(event) => setSelectedSection(event.target.value)}
                className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
              >
                <option value="ALL">All Sections</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.name}>{section.name}</option>
                ))}
              </select>
              <select
                value={selectedSubject}
                aria-label="Filter records by subject"
                disabled={filtersLocked}
                onChange={(event) => setSelectedSubject(event.target.value)}
                className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
              >
                <option value="ALL">All Subjects</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={String(subject.id)}>{subject.name}</option>
                ))}
              </select>
              <select
                value={selectedTerm}
                aria-label="Filter records by term"
                disabled={filtersLocked}
                onChange={(event) => setSelectedTerm(event.target.value)}
                className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
              >
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </select>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--ed-color-52616d)]">Performance level</span>
                <select aria-label="Filter records by performance" value={performanceLevel} disabled={filtersLocked}
                  onChange={(event) => setPerformanceLevel(event.target.value)}
                  className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]">
                  <option value="ALL">All levels ({roster.total})</option>
                  {PERFORMANCE_LEVELS.map(({ label }) => <option key={label} value={label}>{label} ({roster.counts[label]})</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--ed-color-52616d)]">Sort students</span>
                <select aria-label="Sort records students" value={studentSort} disabled={filtersLocked}
                  onChange={(event) => setStudentSort(event.target.value)}
                  className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]">
                  <option value="name">Name: A–Z</option>
                  <option value="highest">Performance: highest first</option>
                  <option value="lowest">Performance: lowest first</option>
                </select>
              </label>
              <input
                type="search"
                aria-label="Search records students"
                disabled={filtersLocked}
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
                placeholder="Search students"
                className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
              />
              {filtersLocked && <p className="text-xs text-[var(--ed-color-71808d)]">Save or cancel score edits to change filters.</p>}
            </div>
          </div>

          <div className="minimal-scrollbar max-h-[55vh] min-h-[240px] space-y-1 overflow-y-auto p-2.5">
            {filteredStudents.map((student) => {
              const isSelected = selectedStudent?.id === student.id;
              const status = getPerformanceStatus(student.averagePercentage);
              return (
                <button
                  key={student.id}
                  type="button"
                  aria-label={`View assessment record for ${student.name}`}
                  aria-current={isSelected ? "true" : undefined}
                  disabled={savingScores}
                  onClick={() => handleSelectStudent(student)}
                  className={`w-full rounded-[16px] px-3.5 py-3.5 text-left ${
                    isSelected
                      ? "bg-[var(--ed-primary)] text-white"
                      : "text-[var(--ed-color-25313c)] hover:bg-[var(--ed-color-f4f7fa)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{student.name}</p>
                      <p className={`mt-1 text-[11px] ${isSelected ? "text-white/80" : "text-[var(--ed-color-8a98a5)]"}`}>
                        Grade {student.grade} · {student.section}
                      </p>
                      <p className={`mt-1 text-[11px] font-medium ${isSelected ? "text-white/90" : "text-[var(--ed-color-52616d)]"}`}>{status.label}</p>
                    </div>
                    <span className={`text-sm font-bold ${isSelected ? "text-white" : "text-[var(--ed-primary)]"}`}>
                      {hasPerformanceGrade(student.averagePercentage) ? student.averagePercentage.toFixed(1) : "—"}
                    </span>
                  </div>
                </button>
              );
            })}

            {filteredStudents.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-[var(--ed-color-8a98a5)]">
                No students match the current filters.
              </div>
            )}
          </div>
        </section>
      </aside>

      <section className="min-w-0 overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
        {!selectedStudent ? (
          <EmptyState
            title="No matching students"
            description="Change the performance level, search, section, subject, or term to find a learner."
          />
        ) : (
          <div>
            <div className="border-b border-[var(--ed-color-eef2f5)] p-6 sm:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">
                    Selected Student
                  </p>
                  <h2 className="mt-2 truncate text-4xl font-extrabold tracking-[-0.04em] text-[var(--ed-primary)] sm:text-5xl">
                    {selectedStudent.name}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--ed-color-71808d)]">
                    Grade {selectedStudent.grade} · {selectedStudent.section} · {currentSubjectLabel} · {currentTermLabel}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedIsEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => saveStudentScores(selectedStudent)}
                        disabled={savingScores}
                        className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:opacity-50"
                      >
                        {savingScores ? "Saving..." : "Save scores"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditingScores}
                        disabled={savingScores}
                        className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)] hover:bg-[var(--ed-color-f4f7fa)]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEditingScores(selectedStudent)}
                        disabled={selectedStudentAssessments.length === 0}
                        className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:bg-[var(--ed-color-c8d1d8)]"
                      >
                        Edit scores
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditStudent(selectedStudent.id)}
                        className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)] hover:border-[var(--ed-primary)] hover:text-[var(--ed-color-168cc8)]"
                      >
                        Edit info
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MinimalMetric
                  label={selectedSubject === "ALL" ? `${currentTermLabel} Average` : `${currentTermLabel} Grade`}
                  value={selectedStudent.averagePercentage === null ? "—" : selectedStudent.averagePercentage.toFixed(1)}
                  detail={`${currentSubjectLabel} · current result`}
                />
                <MinimalMetric
                  label="Performance"
                  value={selectedStatus.label}
                  detail="Based on the current official term result"
                  attention={selectedStudent.averagePercentage !== null && selectedStudent.averagePercentage < 75}
                />
              </div>

              <div className="mt-7 flex flex-wrap gap-2">
                <DetailTabButton active={detailTab === "current"} onClick={() => setDetailTab("current")}>
                  Current Term
                </DetailTabButton>
                <DetailTabButton active={detailTab === "grades"} onClick={() => setDetailTab("grades")}>
                  Term Grades
                </DetailTabButton>
                <DetailTabButton active={detailTab === "history"} onClick={() => setDetailTab("history")}>
                  Assessment History
                </DetailTabButton>
                <DetailTabButton active={detailTab === "insights"} onClick={() => setDetailTab("insights")}>
                  AI Insights
                </DetailTabButton>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              {detailTab === "current" && (
                <CurrentTermScores
                  student={selectedStudent}
                  assessments={selectedStudentAssessments}
                  scoreMap={scoreMap}
                  editing={selectedIsEditing}
                  editedScores={editedScores}
                  savingScores={savingScores}
                  handleEditedScoreChange={handleEditedScoreChange}
                />
              )}

              {detailTab === "grades" && (
                <OfficialGradesTable gradeSummaries={selectedGradeSummaries} />
              )}

              {detailTab === "history" && (
                <AssessmentHistoryTable records={selectedStudentRecords} />
              )}

              {detailTab === "insights" && (
                <SavedInsightsPanel
                  student={selectedStudent}
                  insights={selectedInsights}
                  loading={selectedInsightsLoading}
                  error={selectedInsightError}
                  openSavedInsight={openSavedInsight}
                  reload={() => reloadStudentInsights(selectedStudent.id, true)}
                />
              )}
            </div>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}

function DetailTabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold ${
        active
          ? "bg-[var(--ed-primary)] text-white"
          : "bg-[var(--ed-color-f1f5f7)] text-[var(--ed-color-71808d)] hover:bg-[var(--ed-color-e8eff3)] hover:text-[var(--ed-color-25313c)]"
      }`}
    >
      {children}
    </button>
  );
}

function CurrentTermScores({
  student,
  assessments,
  scoreMap,
  editing,
  editedScores,
  savingScores,
  handleEditedScoreChange,
}) {
  return (
    <div>
      <SectionTitle
        eyebrow="Assessment Scores"
        title="Current Term"
        description="Scores for assessments that match the current subject and term filters."
      />

      <div className="mt-5 minimal-scrollbar overflow-x-auto rounded-[18px] border border-[var(--ed-color-e3e9ee)]">
        <table className="w-full min-w-[760px]">
          <thead className="bg-[var(--ed-color-f8fafb)]">
            <tr className="border-b border-[var(--ed-color-e3e9ee)]">
              <TableHeading>Assessment</TableHeading>
              <TableHeading align="center">Component</TableHeading>
              <TableHeading align="center">HPS</TableHeading>
              <TableHeading align="center">Score</TableHeading>
              <TableHeading align="center">Percentage</TableHeading>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
            {assessments.map((assessment) => {
              const score = scoreMap[student.id]?.[assessment.id];
              const hasScore = score !== undefined && score !== null;
              const percentage =
                hasScore && Number(assessment.total_items) > 0
                  ? (Number(score) / Number(assessment.total_items)) * 100
                  : null;

              return (
                <tr key={assessment.id} className="hover:bg-[var(--ed-color-fbfcfd)]">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[var(--ed-color-25313c)]">{assessment.name}</p>
                    <p className="mt-1 text-xs text-[var(--ed-color-8a98a5)]">
                      {assessment.subject_name} · {assessment.date}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="rounded-full bg-[var(--ed-color-eaf6fc)] px-2.5 py-1 text-xs font-semibold text-[var(--ed-color-168cc8)]">
                      {assessment.slot_label ?? assessment.category_label ?? assessment.type}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center font-semibold text-[var(--ed-color-52616d)]">
                    {assessment.total_items}
                  </td>
                  <td className="px-5 py-4 text-center">
                    {editing ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20">
                          <ValidatedInput
                            kind="integer"
                            label={`Score for ${assessment.name}`}
                            aria-label={`Score for ${assessment.name}`}
                            min={0}
                            max={assessment.total_items}
                            value={editedScores[assessment.id] ?? ""}
                            onChange={(event) => handleEditedScoreChange(assessment.id, event.target.value)}
                            disabled={savingScores}
                            className="w-20 rounded-[10px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-2 py-2 text-center font-semibold text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
                          />
                        </div>
                        <span className="text-xs text-[var(--ed-color-8a98a5)]">/ {assessment.total_items}</span>
                      </div>
                    ) : hasScore ? (
                      <span className="font-semibold text-[var(--ed-color-25313c)]">{score} / {assessment.total_items}</span>
                    ) : (
                      <span className="text-[var(--ed-color-a0abb4)]">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-center font-semibold text-[var(--ed-color-52616d)]">
                    {percentage === null ? "—" : `${percentage.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}

            {assessments.length === 0 && (
              <tr>
                <td colSpan="5" className="px-6 py-14 text-center text-sm text-[var(--ed-color-8a98a5)]">
                  No assessments match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OfficialGradesTable({ gradeSummaries }) {
  return (
    <div>
      <SectionTitle
        eyebrow="Official Grades"
        title="Three-Term Summary"
        description="Term Grades are transmuted individually before the final subject grade is calculated."
      />
      <div className="mt-5 minimal-scrollbar overflow-x-auto rounded-[18px] border border-[var(--ed-color-e3e9ee)]">
        <table className="w-full min-w-[760px]">
          <thead className="bg-[var(--ed-color-f8fafb)]">
            <tr className="border-b border-[var(--ed-color-e3e9ee)]">
              <TableHeading>Subject</TableHeading>
              <TableHeading align="center">Term 1</TableHeading>
              <TableHeading align="center">Term 2</TableHeading>
              <TableHeading align="center">Term 3</TableHeading>
              <TableHeading align="center">Final</TableHeading>
              <TableHeading align="center">Descriptor</TableHeading>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
            {gradeSummaries.map((summary) => (
              <tr key={summary.subject_id}>
                <td className="px-5 py-4 font-semibold text-[var(--ed-color-25313c)]">{summary.subject_name}</td>
                <GradeCell value={summary.term1?.termGrade} />
                <GradeCell value={summary.term2?.termGrade} />
                <GradeCell value={summary.term3?.termGrade} />
                <GradeCell value={summary.final?.finalGrade} accent />
                <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">
                  {summary.final?.descriptor ?? "—"}
                </td>
              </tr>
            ))}
            {gradeSummaries.length === 0 && (
              <tr>
                <td colSpan="6" className="px-6 py-14 text-center text-sm text-[var(--ed-color-8a98a5)]">
                  No official grade summaries are available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GradeCell({ value, accent = false }) {
  return (
    <td className={`px-5 py-4 text-center font-bold ${accent ? "text-[var(--ed-primary)]" : "text-[var(--ed-color-52616d)]"}`}>
      {value ?? "—"}
    </td>
  );
}

function AssessmentHistoryTable({ records }) {
  return (
    <div>
      <SectionTitle
        eyebrow="Assessment History"
        title="Complete Record"
        description="All created assessments for the selected learner across subjects and terms."
      />
      <div className="mt-5 minimal-scrollbar overflow-x-auto rounded-[18px] border border-[var(--ed-color-e3e9ee)]">
        <table className="w-full min-w-[900px]">
          <thead className="bg-[var(--ed-color-f8fafb)]">
            <tr className="border-b border-[var(--ed-color-e3e9ee)]">
              <TableHeading>Assessment</TableHeading>
              <TableHeading>Subject</TableHeading>
              <TableHeading align="center">Term</TableHeading>
              <TableHeading align="center">Component</TableHeading>
              <TableHeading align="center">Score</TableHeading>
              <TableHeading align="center">%</TableHeading>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
            {records.map((record) => {
              const hasScore =
                record.score !== null &&
                record.score !== undefined &&
                Number(record.total_items) > 0;
              const percentage = hasScore
                ? (Number(record.score) / Number(record.total_items)) * 100
                : null;

              return (
                <tr key={record.id}>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[var(--ed-color-25313c)]">{record.assessment_name}</p>
                    <p className="mt-1 text-xs text-[var(--ed-color-8a98a5)]">{record.date}</p>
                  </td>
                  <td className="px-5 py-4 text-sm text-[var(--ed-color-71808d)]">{record.subject_name}</td>
                  <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">{record.term_label ?? `Term ${record.term}`}</td>
                  <td className="px-5 py-4 text-center text-sm font-medium text-[var(--ed-color-168cc8)]">{record.slot_label ?? record.category_label ?? record.type}</td>
                  <td className="px-5 py-4 text-center font-semibold text-[var(--ed-color-52616d)]">{hasScore ? `${record.score}/${record.total_items}` : "—"}</td>
                  <td className="px-5 py-4 text-center font-semibold text-[var(--ed-color-52616d)]">{percentage === null ? "—" : `${percentage.toFixed(1)}%`}</td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan="6" className="px-6 py-14 text-center text-sm text-[var(--ed-color-8a98a5)]">
                  No assessment history is available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SavedInsightsPanel({ student, insights, loading, error, openSavedInsight, reload }) {
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionTitle
          eyebrow="AI Insights"
          title="Saved Recommendations"
          description={`Intervention and enrichment recommendations saved for ${student.name}.`}
        />
        <button
          type="button"
          onClick={reload}
          className="rounded-[11px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)] hover:border-[var(--ed-primary)] hover:text-[var(--ed-color-168cc8)]"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="mt-6 rounded-[16px] bg-[var(--ed-color-f8fafb)] p-8 text-center text-sm text-[var(--ed-color-8a98a5)]">Loading insights...</p>
      ) : error ? (
        <p className="mt-6 rounded-[16px] bg-[var(--ed-color-fff1f1)] p-5 text-sm text-[var(--ed-color-c53939)]">{error}</p>
      ) : insights.length === 0 ? (
        <p className="mt-6 rounded-[16px] bg-[var(--ed-color-f8fafb)] p-8 text-center text-sm text-[var(--ed-color-8a98a5)]">No saved AI insights yet.</p>
      ) : (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {insights.map((insight) => (
            <button
              key={insight.id}
              type="button"
              onClick={() => openSavedInsight(insight)}
              className="rounded-[18px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-5 text-left hover:border-[var(--ed-color-b8ddec)] hover:bg-[var(--ed-color-fbfdff)]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-primary)]">
                {insight.supportType === "intervention" ? "Intervention" : "Enrichment"}
              </p>
              <h4 className="mt-2 text-lg font-bold text-[var(--ed-color-25313c)]">{insight.title || "Saved Recommendation"}</h4>
              <p className="mt-2 text-sm text-[var(--ed-color-71808d)]">{insight.focusLabel || "General learning support"}</p>
              <p className="mt-4 text-xs text-[var(--ed-color-a0abb4)]">{formatSavedDate(insight.createdAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionManagementView({
  sections,
  newSection,
  setNewSection,
  addingSection,
  handleAddSection,
  handleRemoveSection,
  openDashboardForSection,
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-8">
        <SectionTitle
          eyebrow="New Section"
          title="Add a Section"
          description="Create a section that can be assigned when registering students."
        />
        <form onSubmit={handleAddSection} className="mt-7 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--ed-color-52616d)]">Section name</span>
            <ValidatedInput
              kind="section"
              label="Section name"
              required
              value={newSection}
              onChange={(event) => setNewSection(event.target.value)}
              placeholder="e.g. Section 1"
              className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
            />
          </label>
          <button
            type="submit"
            disabled={addingSection || !newSection.trim()}
            className="w-full rounded-[12px] bg-[var(--ed-primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:bg-[var(--ed-color-c8d1d8)]"
          >
            {addingSection ? "Adding..." : "Add section"}
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
        <div className="flex items-end justify-between gap-4 border-b border-[var(--ed-color-eef2f5)] p-6 sm:p-8">
          <SectionTitle
            eyebrow="Existing Sections"
            title="Section List"
            description="Open a section on the dashboard or remove it when it is no longer needed."
          />
          <span className="text-3xl font-bold text-[var(--ed-primary)]">{sections.length}</span>
        </div>
        <div className="minimal-scrollbar max-h-[600px] divide-y divide-[var(--ed-color-eef2f5)] overflow-y-auto">
          {sections.map((section) => (
            <div key={section.id} className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
              <button
                type="button"
                onClick={() => openDashboardForSection(section.name)}
                className="min-w-0 text-left"
              >
                <p className="truncate font-semibold text-[var(--ed-color-25313c)] hover:text-[var(--ed-color-168cc8)]">{section.name}</p>
                <p className="mt-1 text-sm text-[var(--ed-color-8a98a5)]">{section.student_count} students</p>
              </button>
              <button
                type="button"
                onClick={() => handleRemoveSection(section)}
                className="text-sm font-semibold text-[var(--ed-color-d94141)] hover:text-[var(--ed-color-b82e2e)]"
              >
                Remove
              </button>
            </div>
          ))}
          {sections.length === 0 && (
            <EmptyState title="No sections yet" description="Add your first section using the form." />
          )}
        </div>
      </section>
    </div>
  );
}

function SubjectManagementView({
  subjects,
  newSubject,
  setNewSubject,
  addingSubject,
  openSubjectStudentPrompt,
  handleRenameSubject,
  handleRemoveSubject,
  openDashboardForSubject,
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <section className="rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-6 sm:p-8">
        <SectionTitle
          eyebrow="New Subject"
          title="Add a Subject"
          description="Create a subject, then choose the students who should be enrolled."
        />
        <form onSubmit={openSubjectStudentPrompt} className="mt-7 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--ed-color-52616d)]">Subject name</span>
            <ValidatedInput
              kind="subject"
              label="Subject name"
              required
              value={newSubject}
              onChange={(event) => setNewSubject(event.target.value)}
              placeholder="e.g. Mathematics"
              className="w-full rounded-[13px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-4 py-3 text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
            />
          </label>
          <button
            type="submit"
            disabled={addingSubject || !newSubject.trim()}
            className="w-full rounded-[12px] bg-[var(--ed-primary)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:bg-[var(--ed-color-c8d1d8)]"
          >
            {addingSubject ? "Adding..." : "Choose students"}
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
        <div className="flex items-end justify-between gap-4 border-b border-[var(--ed-color-eef2f5)] p-6 sm:p-8">
          <SectionTitle
            eyebrow="Existing Subjects"
            title="Subject List"
            description="Open, rename, or remove subjects from the workspace."
          />
          <span className="text-3xl font-bold text-[var(--ed-primary)]">{subjects.length}</span>
        </div>
        <div className="minimal-scrollbar max-h-[600px] divide-y divide-[var(--ed-color-eef2f5)] overflow-y-auto">
          {subjects.map((subject) => (
            <div key={subject.id} className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
              <button
                type="button"
                onClick={() => openDashboardForSubject(subject.id)}
                className="min-w-0 text-left"
              >
                <p className="truncate font-semibold text-[var(--ed-color-25313c)] hover:text-[var(--ed-color-168cc8)]">{subject.name}</p>
                <p className="mt-1 text-sm text-[var(--ed-color-8a98a5)]">
                  {subject.student_count} students · {subject.assessment_count} assessments
                </p>
              </button>
              <div className="flex shrink-0 gap-3 text-sm font-semibold">
                <button type="button" onClick={() => handleRenameSubject(subject)} className="text-[var(--ed-color-168cc8)] hover:text-[var(--ed-color-0f77aa)]">Rename</button>
                <button type="button" onClick={() => handleRemoveSubject(subject)} className="text-[var(--ed-color-d94141)] hover:text-[var(--ed-color-b82e2e)]">Delete</button>
              </div>
            </div>
          ))}
          {subjects.length === 0 && (
            <EmptyState title="No subjects yet" description="Add your first subject using the form." />
          )}
        </div>
      </section>
    </div>
  );
}

function DashboardFilters({
  sections,
  subjects,
  selectedSection,
  selectedSubject,
  selectedTerm,
  setSelectedSection,
  setSelectedSubject,
  setSelectedTerm,
}) {
  return (
    <section className="rounded-[20px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)] p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FilterSelect
          label="Section"
          value={selectedSection}
          onChange={setSelectedSection}
          options={[
            { value: "ALL", label: "All Sections" },
            ...sections.map((section) => ({ value: section.name, label: section.name })),
          ]}
        />
        <FilterSelect
          label="Subject"
          value={selectedSubject}
          onChange={setSelectedSubject}
          options={[
            { value: "ALL", label: "All Subjects" },
            ...subjects.map((subject) => ({ value: String(subject.id), label: subject.name })),
          ]}
        />
        <FilterSelect
          label="Term"
          value={selectedTerm}
          onChange={setSelectedTerm}
          options={[
            { value: "1", label: "Term 1" },
            { value: "2", label: "Term 2" },
            { value: "3", label: "Term 3" },
          ]}
        />
      </div>
    </section>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ed-color-8a98a5)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[12px] border border-[var(--ed-color-d8e1e7)] bg-[var(--ed-surface)] px-3 py-2.5 text-sm text-[var(--ed-color-25313c)] outline-none focus:border-[var(--ed-primary)]"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function AssessmentList({
  displayedAssessments,
  currentSubjectLabel,
  onEditAssessment,
  handleDeleteAssessment,
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
      <div className="border-b border-[var(--ed-color-eef2f5)] p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">Assessments</p>
        <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">{currentSubjectLabel}</h2>
      </div>
      <div className="minimal-scrollbar overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead className="bg-[var(--ed-color-f8fafb)]">
            <tr className="border-b border-[var(--ed-color-e3e9ee)]">
              <TableHeading>Assessment</TableHeading>
              <TableHeading>Subject</TableHeading>
              <TableHeading align="center">Term</TableHeading>
              <TableHeading align="center">Slot</TableHeading>
              <TableHeading align="center">HPS</TableHeading>
              <TableHeading align="right">Actions</TableHeading>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
            {displayedAssessments.map((assessment) => (
              <tr key={assessment.id} className="hover:bg-[var(--ed-color-fbfcfd)]">
                <td className="px-5 py-4">
                  <p className="font-semibold text-[var(--ed-color-25313c)]">{assessment.name}</p>
                  <p className="mt-1 text-xs text-[var(--ed-color-8a98a5)]">{assessment.date}</p>
                </td>
                <td className="px-5 py-4 text-sm text-[var(--ed-color-71808d)]">{assessment.subject_name}</td>
                <td className="px-5 py-4 text-center text-sm text-[var(--ed-color-71808d)]">{assessment.term_label ?? `Term ${assessment.term}`}</td>
                <td className="px-5 py-4 text-center text-sm font-semibold text-[var(--ed-color-168cc8)]">{assessment.slot_label ?? assessment.category_label ?? assessment.type}</td>
                <td className="px-5 py-4 text-center font-semibold text-[var(--ed-color-52616d)]">{assessment.total_items}</td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-3 text-sm font-semibold">
                    <button type="button" onClick={() => onEditAssessment(assessment.id)} className="text-[var(--ed-color-168cc8)] hover:text-[var(--ed-color-0f77aa)]">Edit</button>
                    <button type="button" onClick={() => handleDeleteAssessment(assessment.id)} className="text-[var(--ed-color-d94141)] hover:text-[var(--ed-color-b82e2e)]">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {displayedAssessments.length === 0 && (
              <tr>
                <td colSpan="6" className="px-6 py-16 text-center text-sm text-[var(--ed-color-8a98a5)]">No assessments match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubjectEnrollmentModal({
  subjectName,
  students,
  filteredStudents,
  searchValue,
  setSearchValue,
  selectedIds,
  setSelectedIds,
  toggleStudent,
  addingSubject,
  closeModal,
  createSubject,
}) {
  const allSelected = students.length > 0 && selectedIds.length === students.length;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#25313C]/35 p-4 backdrop-blur-[4px]">
      <div className="w-full max-w-3xl overflow-hidden rounded-[26px] border border-white bg-[var(--ed-surface)] shadow-[0_24px_70px_rgba(37,49,60,0.24)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--ed-color-eef2f5)] p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">Subject Enrollment</p>
            <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">{subjectName}</h2>
            <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">Choose the students who should be enrolled.</p>
          </div>
          <button type="button" onClick={closeModal} className="flex h-9 w-9 !min-h-0 items-center justify-center rounded-full text-xl text-[var(--ed-color-8a98a5)] hover:bg-[var(--ed-color-f4f7fa)]">×</button>
        </div>

        <div className="p-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search students"
              className="flex-1 rounded-[12px] border border-[var(--ed-color-d8e1e7)] px-4 py-2.5 text-sm outline-none focus:border-[var(--ed-primary)]"
            />
            <button
              type="button"
              onClick={() => setSelectedIds(allSelected ? [] : students.map((student) => student.id))}
              className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)] hover:border-[var(--ed-primary)] hover:text-[var(--ed-color-168cc8)]"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>

          <div className="minimal-scrollbar mt-4 max-h-[440px] divide-y divide-[var(--ed-color-eef2f5)] overflow-y-auto rounded-[16px] border border-[var(--ed-color-e3e9ee)]">
            {filteredStudents.map((student) => {
              const selected = selectedIds.includes(student.id);
              return (
                <label key={student.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[var(--ed-color-fbfcfd)]">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleStudent(student.id)}
                    className="h-4 w-4 accent-[var(--ed-primary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--ed-color-25313c)]">{student.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--ed-color-8a98a5)]">Grade {student.grade} · {student.section}</p>
                  </div>
                </label>
              );
            })}
            {filteredStudents.length === 0 && (
              <p className="px-4 py-12 text-center text-sm text-[var(--ed-color-8a98a5)]">No students found.</p>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-sm text-[var(--ed-color-71808d)]">{selectedIds.length} selected</p>
            <div className="flex gap-2">
              <button type="button" onClick={closeModal} disabled={addingSubject} className="rounded-[12px] border border-[var(--ed-color-d8e1e7)] px-4 py-2.5 text-sm font-semibold text-[var(--ed-color-52616d)]">Cancel</button>
              <button type="button" onClick={createSubject} disabled={addingSubject} className="rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:opacity-50">
                {addingSubject ? "Creating..." : "Create subject"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarButton({ active = false, label, icon, collapsed, danger = false, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center rounded-[12px] px-3 py-2.5 text-sm font-semibold ${
        collapsed ? "justify-center !px-0" : "gap-3"
      } ${description ? "min-h-14 border border-[var(--ed-border)] bg-[var(--ed-subtle)]" : ""} ${
        active
          ? "bg-[var(--ed-color-eaf6fc)] text-[var(--ed-color-168cc8)]"
          : danger
            ? "text-[var(--ed-color-d94141)] hover:bg-[var(--ed-color-fff1f1)]"
            : "text-[var(--ed-color-71808d)] hover:bg-[var(--ed-color-f4f7fa)] hover:text-[var(--ed-color-25313c)]"
      }`}
    >
      {icon === "settings" ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[21px] w-[21px] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="m9.5 3-.5 2-2 1-2-.5-2 3.5L4.5 11v2L3 15l2 3.5 2-.5 2 1 .5 2h5l.5-2 2-1 2 .5 2-3.5-1.5-2v-2L21 9l-2-3.5-2 .5-2-1-.5-2z" /><circle cx="12" cy="12" r="3" /></svg> : icon === "intervention" ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[21px] w-[21px] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M4 20h16M6 16V9m6 7V4m6 12v-5" /></svg> : icon === "archive" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[21px] w-[21px] shrink-0"><rect x="3" y="3" width="18" height="5" rx="1" /><path strokeLinecap="round" strokeLinejoin="round" d="M5 8v12h14V8M10 12h4" /></svg>
      ) : icon === "workspace_premium" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[21px] w-[21px] shrink-0">
          <circle cx="12" cy="8" r="5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="m8 12-2 9 6-3 6 3-2-9M12 5.5v5M9.5 8h5" />
        </svg>
      ) : <span className="material-symbols-rounded shrink-0 text-[21px]" aria-hidden="true">{icon}</span>}
      {!collapsed && <span className="min-w-0 text-left"><span className="block truncate">{label}</span>{description && <span className="mt-0.5 block text-[11px] font-normal text-[var(--ed-muted)]">{description}</span>}</span>}
      {!collapsed && description && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ml-auto h-4 w-4 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" /></svg>}
    </button>
  );
}

function InsightList({
  title,
  description,
  students,
  type,
  onGenerateRecommendation,
  generatingRecommendationKey,
}) {
  const supportType = type === "risk" ? "intervention" : "enrichment";

  return (
    <section className="overflow-hidden rounded-[24px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-surface)]">
      <div className="border-b border-[var(--ed-color-eef2f5)] p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">Learning Support</p>
        <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">{title}</h2>
        {description && <p className="mt-2 text-sm text-[var(--ed-color-71808d)]">{description}</p>}
      </div>
      <div className="divide-y divide-[var(--ed-color-eef2f5)]">
        {students.map((student) => {
          const requestKey = `${supportType}-${student.id}`;
          const isGenerating = generatingRecommendationKey === requestKey;
          return (
            <div key={student.id} className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--ed-color-25313c)]">{student.name}</p>
                <p className="mt-1 text-sm text-[var(--ed-color-71808d)]">{student.section} · {student.averagePercentage.toFixed(1)}</p>
              </div>
              <button
                type="button"
                onClick={() => onGenerateRecommendation(student, supportType)}
                disabled={Boolean(generatingRecommendationKey)}
                className="shrink-0 rounded-[11px] bg-[var(--ed-primary)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--ed-primary-hover)] disabled:opacity-50"
              >
                {isGenerating ? "Generating..." : "Generate"}
              </button>
            </div>
          );
        })}
        {students.length === 0 && (
          <EmptyState title="No students in this group" description="Adjust the filters or wait for more assessment data." />
        )}
      </div>
    </section>
  );
}

function AiRecommendationModal({ recommendation, error, closeModal, onAssignActivity }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const downloadPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true); setPdfError("");
    try {
      const response = await axios.get(`${API_URL}${recommendation.savedInsight.pdfUrl}`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); const link = document.createElement("a"); link.href = url; link.download = `${recommendation.student?.name ?? "student"}-learning-insight.pdf`; link.click(); URL.revokeObjectURL(url);
    } catch { setPdfError("Unable to download this insight. Please try again."); }
    finally { setPdfBusy(false); }
  };
  const plan = recommendation?.plan;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#25313C]/40 p-4 backdrop-blur-[4px]">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[26px] bg-[var(--ed-surface)] shadow-[0_24px_80px_rgba(37,49,60,0.28)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--ed-color-eef2f5)] p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">Gemini Learning Support</p>
            <h2 className="mt-2 text-2xl font-bold text-[var(--ed-color-25313c)]">{plan?.title || "Learning-Support Recommendation"}</h2>
            {recommendation?.student && (
              <p className="mt-2 text-sm text-[var(--ed-color-71808d)]">
                {recommendation.student.name} · Grade {recommendation.student.grade} · {recommendation.student.section} · {recommendation.focusLabel}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {recommendation?.savedInsight?.pdfUrl && (
              <button type="button" onClick={downloadPdf} disabled={pdfBusy}
                className="inline-flex min-h-11 items-center rounded-[12px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]"
              >
                {pdfBusy ? "Downloading…" : "Download PDF"}
              </button>
            )}
            <button type="button" onClick={closeModal} className="flex h-10 w-10 !min-h-0 items-center justify-center rounded-full text-2xl text-[var(--ed-color-8a98a5)] hover:bg-[var(--ed-color-f4f7fa)]">×</button>
          </div>
        </div>

        <div className="minimal-scrollbar max-h-[calc(92vh-105px)] overflow-y-auto p-6 sm:p-8">
          {pdfError && <p role="alert" className="mb-4 text-sm text-[var(--ed-danger)]">{pdfError}</p>}
          {error ? (
            <div className="rounded-[18px] bg-[var(--ed-color-fff1f1)] p-5 text-sm text-[var(--ed-color-c53939)]">{error}</div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MinimalInfo label="Classification" value={recommendation?.classification || "—"} />
                <MinimalInfo label="Focus Average" value={formatPercentage(recommendation?.analytics?.focusAveragePercentage)} />
                <MinimalInfo label="Section Average" value={formatPercentage(recommendation?.analytics?.sectionComparison?.sectionAveragePercentage)} />
                <MinimalInfo label="Recent Trend" value={recommendation?.analytics?.recentTrend?.label || "—"} />
              </div>

              {plan?.overview && (
                <RecommendationSection title="Overview">
                  <p className="max-w-4xl leading-7 text-[var(--ed-color-52616d)]">{plan.overview}</p>
                </RecommendationSection>
              )}

              {plan?.evidence?.length > 0 && (
                <RecommendationSection title="Evidence Used">
                  <div className="grid gap-3 md:grid-cols-2">
                    {plan.evidence.map((item, index) => (
                      <div key={`${item.observation}-${index}`} className="rounded-[16px] border border-[var(--ed-color-e3e9ee)] p-4">
                        <p className="font-semibold text-[var(--ed-color-25313c)]">{item.observation}</p>
                        <p className="mt-2 text-sm text-[var(--ed-color-71808d)]">{item.dataPoint}</p>
                      </div>
                    ))}
                  </div>
                </RecommendationSection>
              )}

              {plan?.targetedInterventions?.length > 0 && (
                <RecommendationSection title="Targeted Interventions">
                  <div className="space-y-4">
                    {plan.targetedInterventions.map((item, index) => (
                      <RecommendationCard key={`${item.title}-${index}`} index={index + 1} title={item.title} description={item.rationale}>
                        {item.actions?.length > 0 && (
                          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--ed-color-52616d)]">
                            {item.actions.map((action, actionIndex) => <li key={`${action}-${actionIndex}`}>{action}</li>)}
                          </ul>
                        )}
                        {item.practiceActivities?.length > 0 && (
                          <div className="mt-5 space-y-4">
                            {item.practiceActivities.map((activity) => (
                              <div key={activity.difficulty} className="rounded-[16px] border border-[var(--ed-color-e3e9ee)] bg-[var(--ed-color-f8fafb)] p-4">
                                <p className="text-xs font-bold uppercase text-[var(--ed-color-168cc8)]">{activity.difficulty} practice · {activity.duration}</p>
                                {onAssignActivity && <button type="button" onClick={() => onAssignActivity(activity)} className="mt-2 text-xs font-semibold text-[var(--ed-accent-text)] underline">Use in intervention tracker</button>}
                                <h5 className="mt-2 font-bold text-[var(--ed-color-25313c)]">{activity.title}</h5>
                                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ed-color-52616d)]">{activity.objective}</p>
                                <p className="mt-2 text-sm text-[var(--ed-color-71808d)]">Materials: {activity.materials?.join(", ")}</p>
                                <p className="mt-3 text-sm font-semibold">Instructions</p>
                                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-[var(--ed-color-52616d)]">
                                  {activity.instructions?.map((step, i) => <li className="whitespace-pre-wrap" key={i}>{step}</li>)}
                                </ol>
                                <p className="mt-3 text-sm font-semibold">Practice tasks</p>
                                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-[var(--ed-color-52616d)]">
                                  {activity.tasks?.map((task, i) => <li className="whitespace-pre-wrap" key={i}>{task}</li>)}
                                </ol>
                                <details className="mt-3 text-sm text-[var(--ed-color-52616d)]">
                                  <summary className="cursor-pointer font-semibold">Teacher answer key / scoring criteria</summary>
                                  <ul className="mt-2 list-disc space-y-2 pl-5">
                                    {activity.answerKey?.map((answer, i) => <li className="whitespace-pre-wrap" key={i}>{answer}</li>)}
                                  </ul>
                                </details>
                                <div className="mt-3"><PlanDetail label="Mastery check" value={activity.masteryCheck} /></div>
                              </div>
                            ))}
                            <PlanDetail label="Progression between levels" value={item.progressionRule} />
                          </div>
                        )}
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <PlanDetail label="Schedule" value={item.schedule} />
                          <PlanDetail label="Success indicator" value={item.successIndicator} />
                        </div>
                      </RecommendationCard>
                    ))}
                  </div>
                </RecommendationSection>
              )}

              {plan?.enrichmentActivities?.length > 0 && (
                <RecommendationSection title="Enrichment Activities">
                  <div className="grid gap-4 lg:grid-cols-2">
                    {plan.enrichmentActivities.map((item, index) => (
                      <RecommendationCard key={`${item.title}-${index}`} index={index + 1} title={item.title} description={item.description}>
                        <div className="mt-4 space-y-3">
                          <PlanDetail label="Implementation" value={item.implementation} />
                          <PlanDetail label="Expected outcome" value={item.expectedOutcome} />
                        </div>
                      </RecommendationCard>
                    ))}
                  </div>
                </RecommendationSection>
              )}

              {plan?.monitoringPlan?.length > 0 && (
                <RecommendationSection title="Progress Monitoring">
                  <div className="minimal-scrollbar overflow-x-auto rounded-[16px] border border-[var(--ed-color-e3e9ee)]">
                    <table className="w-full min-w-[650px]">
                      <thead className="bg-[var(--ed-color-f8fafb)]">
                        <tr><TableHeading>Metric</TableHeading><TableHeading>Frequency</TableHeading><TableHeading>Target</TableHeading></tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ed-color-eef2f5)]">
                        {plan.monitoringPlan.map((item, index) => (
                          <tr key={`${item.metric}-${index}`}>
                            <td className="px-5 py-4 text-sm text-[var(--ed-color-52616d)]">{item.metric}</td>
                            <td className="px-5 py-4 text-sm text-[var(--ed-color-52616d)]">{item.frequency}</td>
                            <td className="px-5 py-4 text-sm text-[var(--ed-color-52616d)]">{item.target}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </RecommendationSection>
              )}

              {plan?.teacherNotes?.length > 0 && (
                <RecommendationSection title="Teacher Notes">
                  <ul className="list-disc space-y-2 pl-5 text-[var(--ed-color-52616d)]">
                    {plan.teacherNotes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}
                  </ul>
                </RecommendationSection>
              )}

              <p className="border-t border-[var(--ed-color-eef2f5)] pt-5 text-sm leading-6 text-[var(--ed-color-8a98a5)]">
                Review AI recommendations using professional judgment and your knowledge of the learner before applying them.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MinimalInfo({ label, value }) {
  return (
    <div className="rounded-[16px] bg-[var(--ed-color-f4f7fa)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)]">{label}</p>
      <p className="mt-2 font-bold text-[var(--ed-color-25313c)]">{value}</p>
    </div>
  );
}

function RecommendationSection({ title, children }) {
  return (
    <section>
      <h3 className="mb-4 text-xl font-bold text-[var(--ed-color-25313c)]">{title}</h3>
      {children}
    </section>
  );
}

function RecommendationCard({ index, title, description, children }) {
  return (
    <div className="rounded-[18px] border border-[var(--ed-color-e3e9ee)] p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ed-primary)] text-sm font-bold text-white">{index}</span>
        <div className="min-w-0">
          <h4 className="font-bold text-[var(--ed-color-25313c)]">{title}</h4>
          {description && <p className="mt-2 text-sm leading-6 text-[var(--ed-color-52616d)]">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function PlanDetail({ label, value }) {
  return (
    <div className="rounded-[14px] bg-[var(--ed-color-f8fafb)] p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ed-color-8a98a5)]">{label}</p>
      <p className="mt-1.5 text-sm leading-5 text-[var(--ed-color-52616d)]">{value || "—"}</p>
    </div>
  );
}

function SectionTitle({ eyebrow, title, description }) {
  return (
    <div>
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-primary)]">{eyebrow}</p>}
      <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-[var(--ed-color-25313c)]">{title}</h2>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ed-color-71808d)]">{description}</p>}
    </div>
  );
}

function EmptyState({ title, description, actionLabel, onAction }) {
  return (
    <div className="px-6 py-14 text-center">
      <h3 className="text-lg font-semibold text-[var(--ed-color-52616d)]">{title}</h3>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ed-color-8a98a5)]">{description}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="mt-4 rounded-[11px] bg-[var(--ed-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--ed-primary-hover)]">{actionLabel}</button>
      )}
    </div>
  );
}

function formatPercentage(value) {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
}

function formatSavedDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function TableHeading({ children, align = "left" }) {
  return (
    <th
      scope="col"
      className={`px-5 py-3.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ed-color-8a98a5)] ${
        align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

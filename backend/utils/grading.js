import { currentRules } from "../services/academicContext.js";
/*
  ============================================================
  EduLITE 3-Term Grading Engine
  ============================================================

  STRUCTURE PER TERM

  Written / Oral Works
      WW1
      WW2
      WW3
      WW4
      WW5
      Weight = 20%

  Product / Performance Tasks
      PT1
      PT2
      PT3
      Weight = 50%

  Summative Tests + Term Examination
      ST1
      ST2
      Term Exam
      Weight = 30%

  Examination internal weights:
      ST1       = 30%
      ST2       = 30%
      Term Exam = 40%

  ============================================================
  IMPORTANT BEHAVIOR
  ============================================================

  1. WW has a maximum of 5 slots.
  2. PT has a maximum of 3 slots.
  3. ST has exactly ST1 and ST2.
  4. There is one Term Exam.

  5. UNUSED / NOT-CREATED WW/PT slots DO NOT affect grades.

     Example:
        WW1 exists
        WW2 exists
        WW3-WW5 do not exist

     Only WW1 and WW2 HPS are included.

  6. If an assessment EXISTS but a learner score is blank:

        - HPS remains in denominator
        - blank raw score contributes 0 in Excel-style SUM
        - stored learner score remains null

  7. Legacy WW/PT assessments created by the earlier EduLITE
     implementation may have:

        sequence = null

     These records are NOT discarded.

     They are automatically assigned an effective WW/PT slot
     for calculation only.

     Example:
        old written_work sequence null
        old written_work sequence null

     becomes, for calculation:
        WW1
        WW2

     This DOES NOT modify MongoDB.

  8. ST1/ST2/Term Exam remain strict because their sequence
     changes the actual formula.

  9. If ST1/ST2/TE structure is incomplete, Examination WS
     remains blank.

  10. Once the learner has a Term Exam score, the Excel-style
      running Initial Grade is transmuted and displayed.

  11. A Term Grade can therefore exist even when the term is
      only partially complete.

      isComplete:
          Term Grade exists

      isFullyComplete:
          all created WW/PT scores are encoded AND
          ST1/ST2/TE exist and have scores

  ============================================================
*/


/*
  ============================================================
  TERMS
  ============================================================
*/

export const TERM_NUMBERS = Object.freeze([
  1,
  2,
  3,
]);


/*
  ============================================================
  GRADING CATEGORIES
  ============================================================
*/

export const GRADING_CATEGORIES = Object.freeze({
  WRITTEN_WORK:
    "written_work",

  PERFORMANCE_TASK:
    "performance_task",

  SUMMATIVE_TEST:
    "summative_test",

  TERM_EXAM:
    "term_exam",
});


export const CATEGORY_LABELS = Object.freeze({
  written_work:
    "Written / Oral Works",

  performance_task:
    "Product / Performance Tasks",

  summative_test:
    "Summative Tests",

  term_exam:
    "Term Examination",
});


/*
  ============================================================
  FIXED ECR SLOT LIMITS
  ============================================================
*/

export const ASSESSMENT_SLOT_LIMITS = Object.freeze({
  written_work: Object.freeze({
    minimumSequence:
      1,

    maximumSequence:
      5,

    allowedSequences:
      Object.freeze([
        1,
        2,
        3,
        4,
        5,
      ]),
  }),

  performance_task: Object.freeze({
    minimumSequence:
      1,

    maximumSequence:
      3,

    allowedSequences:
      Object.freeze([
        1,
        2,
        3,
      ]),
  }),

  summative_test: Object.freeze({
    minimumSequence:
      1,

    maximumSequence:
      2,

    allowedSequences:
      Object.freeze([
        1,
        2,
      ]),
  }),

  term_exam: Object.freeze({
    minimumSequence:
      1,

    maximumSequence:
      1,

    allowedSequences:
      Object.freeze([
        1,
      ]),
  }),
});


/*
  ============================================================
  COMPONENT WEIGHTS
  ============================================================
*/

export const COMPONENT_WEIGHTS = Object.freeze({
  written_work:
    0.20,

  performance_task:
    0.50,

  examination:
    0.30,
});


export const EXAMINATION_INTERNAL_WEIGHTS = Object.freeze({
  summative_test_1:
    0.30,

  summative_test_2:
    0.30,

  term_exam:
    0.40,
});


/*
  ============================================================
  PERFORMANCE THRESHOLDS
  ============================================================
*/

export const PASSING_GRADE =
  75;

export const HIGH_PERFORMING_GRADE =
  90;


/*
  ============================================================
  TRANSMUTATION TABLE
  ============================================================

  Approximate/lower-bound lookup matching the reference ECR.

  Examples:

      0      -> 60
      30     -> 66
      47.50  -> 70
      56.80  -> 72
      60     -> 72
      70     -> 75
*/

export const TRANSMUTATION_TABLE = Object.freeze([
  Object.freeze({
    min: 0.00,
    max: 4.67,
    grade: 60,
  }),

  Object.freeze({
    min: 4.68,
    max: 9.34,
    grade: 61,
  }),

  Object.freeze({
    min: 9.35,
    max: 14.00,
    grade: 62,
  }),

  Object.freeze({
    min: 14.01,
    max: 18.67,
    grade: 63,
  }),

  Object.freeze({
    min: 18.68,
    max: 23.34,
    grade: 64,
  }),

  Object.freeze({
    min: 23.35,
    max: 28.00,
    grade: 65,
  }),

  Object.freeze({
    min: 28.01,
    max: 32.67,
    grade: 66,
  }),

  Object.freeze({
    min: 32.68,
    max: 37.33,
    grade: 67,
  }),

  Object.freeze({
    min: 37.34,
    max: 42.00,
    grade: 68,
  }),

  Object.freeze({
    min: 42.01,
    max: 46.66,
    grade: 69,
  }),

  Object.freeze({
    min: 46.67,
    max: 51.33,
    grade: 70,
  }),

  Object.freeze({
    min: 51.34,
    max: 56.00,
    grade: 71,
  }),

  Object.freeze({
    min: 56.01,
    max: 60.66,
    grade: 72,
  }),

  Object.freeze({
    min: 60.67,
    max: 65.33,
    grade: 73,
  }),

  Object.freeze({
    min: 65.34,
    max: 69.99,
    grade: 74,
  }),

  Object.freeze({
    min: 70.00,
    max: 71.17,
    grade: 75,
  }),

  Object.freeze({
    min: 71.18,
    max: 72.35,
    grade: 76,
  }),

  Object.freeze({
    min: 72.36,
    max: 73.53,
    grade: 77,
  }),

  Object.freeze({
    min: 73.54,
    max: 74.71,
    grade: 78,
  }),

  Object.freeze({
    min: 74.72,
    max: 75.89,
    grade: 79,
  }),

  Object.freeze({
    min: 75.90,
    max: 77.07,
    grade: 80,
  }),

  Object.freeze({
    min: 77.08,
    max: 78.25,
    grade: 81,
  }),

  Object.freeze({
    min: 78.26,
    max: 79.43,
    grade: 82,
  }),

  Object.freeze({
    min: 79.44,
    max: 80.61,
    grade: 83,
  }),

  Object.freeze({
    min: 80.62,
    max: 81.79,
    grade: 84,
  }),

  Object.freeze({
    min: 81.80,
    max: 82.97,
    grade: 85,
  }),

  Object.freeze({
    min: 82.98,
    max: 84.15,
    grade: 86,
  }),

  Object.freeze({
    min: 84.16,
    max: 85.33,
    grade: 87,
  }),

  Object.freeze({
    min: 85.34,
    max: 86.51,
    grade: 88,
  }),

  Object.freeze({
    min: 86.52,
    max: 87.69,
    grade: 89,
  }),

  Object.freeze({
    min: 87.70,
    max: 88.87,
    grade: 90,
  }),

  Object.freeze({
    min: 88.88,
    max: 90.05,
    grade: 91,
  }),

  Object.freeze({
    min: 90.06,
    max: 91.23,
    grade: 92,
  }),

  Object.freeze({
    min: 91.24,
    max: 92.41,
    grade: 93,
  }),

  Object.freeze({
    min: 92.42,
    max: 93.59,
    grade: 94,
  }),

  Object.freeze({
    min: 93.60,
    max: 94.77,
    grade: 95,
  }),

  Object.freeze({
    min: 94.78,
    max: 95.95,
    grade: 96,
  }),

  Object.freeze({
    min: 95.96,
    max: 97.13,
    grade: 97,
  }),

  Object.freeze({
    min: 97.14,
    max: 98.31,
    grade: 98,
  }),

  Object.freeze({
    min: 98.32,
    max: 99.49,
    grade: 99,
  }),

  Object.freeze({
    min: 99.50,
    max: 100.00,
    grade: 100,
  }),
]);


/*
  ============================================================
  CONFIGURATION VALIDATION
  ============================================================
*/

function validateWeightConfiguration() {
  const overallTotal =
    (currentRules().writtenWorkWeight / 100) +
    (currentRules().performanceTaskWeight / 100) +
    (currentRules().examinationWeight / 100);

  const examinationTotal =
    EXAMINATION_INTERNAL_WEIGHTS
      .summative_test_1 +
    EXAMINATION_INTERNAL_WEIGHTS
      .summative_test_2 +
    EXAMINATION_INTERNAL_WEIGHTS
      .term_exam;

  const tolerance =
    0.0000001;

  if (
    Math.abs(
      overallTotal - 1,
    ) > tolerance
  ) {
    throw new Error(
      "Invalid grading configuration: overall component weights must total 100%.",
    );
  }

  if (
    Math.abs(
      examinationTotal - 1,
    ) > tolerance
  ) {
    throw new Error(
      "Invalid grading configuration: examination weights must total 100%.",
    );
  }
}


validateWeightConfiguration();


/*
  ============================================================
  NUMBER HELPERS
  ============================================================
*/

export function round(
  value,
  digits = 2,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue,
    )
  ) {
    return null;
  }

  const multiplier =
    10 ** digits;

  return (
    Math.round(
      (
        numericValue +
        Number.EPSILON
      ) *
        multiplier,
    ) /
    multiplier
  );
}


export function isValidNumericScore(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return false;
  }

  return Number.isFinite(
    Number(value),
  );
}


export function isValidHps(
  value,
) {
  const numericValue =
    Number(value);

  return (
    Number.isFinite(
      numericValue,
    ) &&
    numericValue > 0
  );
}


/*
  ============================================================
  SLOT HELPERS
  ============================================================
*/

export function isValidAssessmentSequence(
  category,
  sequence,
) {
  const configuration =
    ASSESSMENT_SLOT_LIMITS[
      category
    ];

  if (!configuration) {
    return false;
  }

  const numericSequence =
    Number(sequence);

  return (
    Number.isInteger(
      numericSequence,
    ) &&
    configuration
      .allowedSequences
      .includes(
        numericSequence,
      )
  );
}


export function getAssessmentSlotLabel(
  category,
  sequence,
) {
  if (
    !isValidAssessmentSequence(
      category,
      sequence,
    )
  ) {
    return null;
  }

  if (
    category ===
    GRADING_CATEGORIES
      .WRITTEN_WORK
  ) {
    return `WW${sequence}`;
  }

  if (
    category ===
    GRADING_CATEGORIES
      .PERFORMANCE_TASK
  ) {
    return `PT${sequence}`;
  }

  if (
    category ===
    GRADING_CATEGORIES
      .SUMMATIVE_TEST
  ) {
    return `ST${sequence}`;
  }

  if (
    category ===
    GRADING_CATEGORIES
      .TERM_EXAM
  ) {
    return "Term Exam";
  }

  return null;
}


/*
  ============================================================
  RECORD NORMALIZATION
  ============================================================
*/

export function normalizeGradeRecord(
  record,
) {
  if (
    !record ||
    typeof record !== "object"
  ) {
    return null;
  }

  const assessmentId =
    record.assessmentId ??
    record.assessment_id ??
    record._id ??
    record.id ??
    null;

  const rawScore =
    record.score;

  const score =
    rawScore === null ||
    rawScore === undefined ||
    rawScore === ""
      ? null
      : Number(rawScore);

  const rawSequence =
    record.sequence;

  const sequence =
    rawSequence === null ||
    rawSequence === undefined ||
    rawSequence === ""
      ? null
      : Number(rawSequence);

  const rawTerm =
    record.term;

  const term =
    Number(rawTerm);

  const rawTotalItems =
    record.totalItems ??
    record.total_items;

  const totalItems =
    Number(rawTotalItems);

  return {
    assessmentId:
      assessmentId
        ? String(assessmentId)
        : null,

    name:
      record.name ??
      record.assessment_name ??
      "",

    category:
      record.category ??
      null,

    /*
      Preserve null for legacy WW/PT assessments.
    */
    sequence:
      Number.isInteger(
        sequence,
      )
        ? sequence
        : null,

    term:
      Number.isInteger(
        term,
      )
        ? term
        : null,

    score:
      Number.isFinite(
        score,
      )
        ? score
        : null,

    totalItems:
      Number.isFinite(
        totalItems,
      )
        ? totalItems
        : null,

    date:
      record.date ??
      null,
  };
}


/*
  ============================================================
  ASSESSMENT PERCENTAGE
  ============================================================
*/

export function calculatePercentageScore(
  score,
  highestPossibleScore,
) {
  if (
    !isValidNumericScore(
      score,
    ) ||
    !isValidHps(
      highestPossibleScore,
    )
  ) {
    return null;
  }

  const numericScore =
    Number(score);

  const hps =
    Number(
      highestPossibleScore,
    );

  if (
    numericScore < 0 ||
    numericScore > hps
  ) {
    return null;
  }

  /*
    Retain precision internally.
  */
  return (
    numericScore /
    hps
  ) *
    100;
}


/*
  Backward compatibility.
*/

export const calculateAssessmentPercentage =
  calculatePercentageScore;


/*
  ============================================================
  WEIGHTED SCORE
  ============================================================
*/

export function calculateWeightedScore(
  percentageScore,
  weight,
) {
  if (
    percentageScore === null ||
    percentageScore === undefined ||
    !Number.isFinite(
      Number(
        percentageScore,
      ),
    ) ||
    !Number.isFinite(
      Number(weight),
    )
  ) {
    return null;
  }

  return (
    Number(
      percentageScore,
    ) *
    Number(weight)
  );
}


/*
  ============================================================
  DUPLICATE SEQUENCE HELPER
  ============================================================
*/

function findDuplicateSequences(
  records,
) {
  const seen =
    new Set();

  const duplicates =
    new Set();

  for (const record of records) {
    const sequence =
      Number(
        record.sequence,
      );

    if (
      !Number.isInteger(
        sequence,
      )
    ) {
      continue;
    }

    if (
      seen.has(sequence)
    ) {
      duplicates.add(
        sequence,
      );
    }

    seen.add(sequence);
  }

  return [
    ...duplicates,
  ].sort(
    (
      first,
      second,
    ) =>
      first - second,
  );
}


/*
  ============================================================
  FIXED WW / PT AGGREGATE CATEGORY
  ============================================================

  Used for:

      written_work
      performance_task

  Current structured records use real sequence numbers.

  Legacy records with sequence = null are also supported.

  Example:

      written_work sequence null
      written_work sequence null

  If WW1-WW5 are otherwise unused, they become:

      effective WW1
      effective WW2

  for calculation only.

  MongoDB is NOT modified here.
*/

function calculateFixedAggregateCategory({
  records,
  category,
  weight,
}) {
  const slotConfiguration =
    ASSESSMENT_SLOT_LIMITS[
      category
    ];

  const categoryRecords =
    records.filter(
      (record) =>
        record.category ===
        category,
    );

  const maximumSlots =
    slotConfiguration
      .maximumSequence;

  /*
    ==========================================================
    NO CREATED ASSESSMENTS
    ==========================================================
  */

  if (
    categoryRecords.length === 0
  ) {
    return {
      category,

      label:
        CATEGORY_LABELS[
          category
        ],

      weight,

      maximumSlots,

      allowedSequences: [
        ...slotConfiguration
          .allowedSequences,
      ],

      status:
        "NOT_STARTED",

      hasCreatedAssessments:
        false,

      hasAnyScore:
        false,

      isCalculated:
        false,

      isFullyComplete:
        false,

      createdCount:
        0,

      availableSlotCount:
        maximumSlots,

      recordedCount:
        0,

      missingScoreCount:
        0,

      duplicateSequences:
        [],

      invalidSequences:
        [],

      legacyUnsequencedCount:
        0,

      exceedsMaximum:
        false,

      totalScoreRaw:
        null,

      totalScore:
        null,

      totalHps:
        null,

      percentageScoreRaw:
        null,

      percentageScore:
        null,

      weightedScoreRaw:
        null,

      weightedScore:
        null,

      assessments:
        [],
    };
  }

  /*
    ==========================================================
    MAXIMUM COUNT
    ==========================================================
  */

  const exceedsMaximum =
    categoryRecords.length >
    maximumSlots;

  /*
    ==========================================================
    SPLIT CURRENT VS LEGACY RECORDS
    ==========================================================
  */

  const usedSequences =
    new Set();

  const duplicateSequences =
    new Set();

  const recordsWithValidSequence =
    [];

  const legacyUnsequencedRecords =
    [];

  const invalidSequenceRecords =
    [];

  for (
    const record
    of categoryRecords
  ) {
    /*
      Proper modern WW/PT slot.
    */
    if (
      isValidAssessmentSequence(
        category,
        record.sequence,
      )
    ) {
      const sequence =
        Number(
          record.sequence,
        );

      if (
        usedSequences.has(
          sequence,
        )
      ) {
        duplicateSequences.add(
          sequence,
        );
      } else {
        usedSequences.add(
          sequence,
        );
      }

      recordsWithValidSequence.push({
        ...record,

        effectiveSequence:
          sequence,

        isLegacyUnsequenced:
          false,
      });

      continue;
    }

    /*
      Legacy record created while EduLITE stored WW/PT
      sequence = null.
    */
    if (
      record.sequence === null ||
      record.sequence === undefined ||
      record.sequence === ""
    ) {
      legacyUnsequencedRecords.push(
        record,
      );

      continue;
    }

    /*
      Genuine malformed record such as:

        WW6
        PT4
    */
    invalidSequenceRecords.push(
      record,
    );
  }

  /*
    ==========================================================
    DETERMINISTIC LEGACY ORDERING
    ==========================================================

    Old unsequenced assessments are assigned to available
    slots in date order.

    If dates match, assessment ID/name provides stable order.
  */

  legacyUnsequencedRecords.sort(
    (
      first,
      second,
    ) => {
      const firstDate =
        first.date
          ? new Date(
              first.date,
            ).getTime()
          : 0;

      const secondDate =
        second.date
          ? new Date(
              second.date,
            ).getTime()
          : 0;

      if (
        firstDate !== secondDate
      ) {
        return (
          firstDate -
          secondDate
        );
      }

      return String(
        first.assessmentId ??
        first.name ??
        "",
      ).localeCompare(
        String(
          second.assessmentId ??
          second.name ??
          "",
        ),
      );
    },
  );

  /*
    ==========================================================
    ASSIGN EFFECTIVE LEGACY SLOTS
    ==========================================================
  */

  const assignedLegacyRecords =
    [];

  for (
    const record
    of legacyUnsequencedRecords
  ) {
    const availableSequence =
      slotConfiguration
        .allowedSequences
        .find(
          (sequence) =>
            !usedSequences.has(
              sequence,
            ),
        );

    /*
      No remaining fixed slot.
    */
    if (
      availableSequence ===
      undefined
    ) {
      assignedLegacyRecords.push({
        ...record,

        effectiveSequence:
          null,

        isLegacyUnsequenced:
          true,
      });

      continue;
    }

    usedSequences.add(
      availableSequence,
    );

    assignedLegacyRecords.push({
      ...record,

      effectiveSequence:
        availableSequence,

      isLegacyUnsequenced:
        true,
    });
  }

  /*
    ==========================================================
    FINAL EFFECTIVE RECORD SET
    ==========================================================
  */

  const effectiveRecords = [
    ...recordsWithValidSequence,
    ...assignedLegacyRecords,
  ].sort(
    (
      first,
      second,
    ) =>
      Number(
        first.effectiveSequence ??
        999,
      ) -
      Number(
        second.effectiveSequence ??
        999,
      ),
  );

  /*
    ==========================================================
    BUILD ASSESSMENT DETAILS
    ==========================================================
  */

  const assessments =
    effectiveRecords.map(
      (record) => {
        const validHps =
          isValidHps(
            record.totalItems,
          );

        const hasScore =
          isValidNumericScore(
            record.score,
          );

        const numericScore =
          hasScore
            ? Number(
                record.score,
              )
            : null;

        /*
          Blank score is not considered invalid.

          It remains null, but it may contribute zero to Excel
          SUM later.
        */
        const scoreWithinRange =
          !hasScore
            ? true
            : (
                validHps &&
                numericScore >= 0 &&
                numericScore <=
                  Number(
                    record.totalItems,
                  )
              );

        const percentageScoreRaw =
          hasScore &&
          validHps &&
          scoreWithinRange
            ? calculatePercentageScore(
                numericScore,
                record.totalItems,
              )
            : null;

        return {
          assessmentId:
            record.assessmentId,

          name:
            record.name,

          date:
            record.date,

          /*
            Original database value.
          */
          sequence:
            record.sequence ??
            null,

          /*
            Effective slot used by the ECR calculation.
          */
          effectiveSequence:
            record.effectiveSequence,

          slotLabel:
            record.effectiveSequence
              ? getAssessmentSlotLabel(
                  category,
                  record.effectiveSequence,
                )
              : null,

          isLegacyUnsequenced:
            record.isLegacyUnsequenced,

          score:
            numericScore,

          totalItems:
            record.totalItems,

          validHps,

          hasScore,

          scoreWithinRange,

          percentageScoreRaw,

          percentageScore:
            percentageScoreRaw ===
            null
              ? null
              : round(
                  percentageScoreRaw,
                  2,
                ),
        };
      },
    );

  /*
    ==========================================================
    VALIDITY
    ==========================================================
  */

  const hasInvalidHps =
    assessments.some(
      (assessment) =>
        !assessment.validHps,
    );

  const hasInvalidScore =
    assessments.some(
      (assessment) =>
        !assessment
          .scoreWithinRange,
    );

  const recordedAssessments =
    assessments.filter(
      (assessment) =>
        assessment.hasScore &&
        assessment.validHps &&
        assessment
          .scoreWithinRange,
    );

  const hasAnyScore =
    recordedAssessments.length >
    0;

  /*
    ==========================================================
    HPS TOTAL

    ONLY CREATED ASSESSMENTS.
    ==========================================================
  */

  const totalHps =
    assessments.reduce(
      (
        total,
        assessment,
      ) =>
        total +
        (
          assessment.validHps
            ? Number(
                assessment.totalItems,
              )
            : 0
        ),

      0,
    );

  /*
    ==========================================================
    RAW SCORE TOTAL

    Existing assessment with blank score contributes 0 to
    Excel-style SUM.

    Database score remains null.
    ==========================================================
  */

  const totalScoreRaw =
    assessments.reduce(
      (
        total,
        assessment,
      ) =>
        total +
        (
          assessment.hasScore &&
          assessment
            .scoreWithinRange
            ? Number(
                assessment.score,
              )
            : 0
        ),

      0,
    );

  const duplicates = [
    ...duplicateSequences,
  ].sort(
    (
      first,
      second,
    ) =>
      first - second,
  );

  /*
    ==========================================================
    CAN CALCULATE
    ==========================================================
  */

  const isCalculated =
    hasAnyScore &&
    !hasInvalidHps &&
    !hasInvalidScore &&
    duplicates.length === 0 &&
    invalidSequenceRecords.length ===
      0 &&
    !exceedsMaximum &&
    totalHps > 0;

  /*
    Fully complete refers ONLY to created assessments.

    We do not require unused WW/PT slots to exist.
  */

  const isFullyComplete =
    assessments.length > 0 &&
    isCalculated &&
    assessments.every(
      (assessment) =>
        assessment.hasScore,
    );

  /*
    ==========================================================
    PERCENTAGE + WEIGHTED SCORE
    ==========================================================
  */

  const percentageScoreRaw =
    isCalculated
      ? (
          totalScoreRaw /
          totalHps
        ) *
        100
      : null;

  const weightedScoreRaw =
    percentageScoreRaw ===
    null
      ? null
      : calculateWeightedScore(
          percentageScoreRaw,
          weight,
        );

  /*
    ==========================================================
    STATUS
    ==========================================================
  */

  let status =
    "PARTIAL";

  if (
    !hasAnyScore
  ) {
    status =
      "PENDING";
  }

  if (
    isFullyComplete
  ) {
    status =
      "COMPLETE";
  }

  if (
    hasInvalidHps ||
    hasInvalidScore ||
    duplicates.length > 0 ||
    invalidSequenceRecords.length >
      0 ||
    exceedsMaximum
  ) {
    status =
      "INVALID";
  }

  return {
    category,

    label:
      CATEGORY_LABELS[
        category
      ],

    weight,

    maximumSlots,

    allowedSequences: [
      ...slotConfiguration
        .allowedSequences,
    ],

    status,

    hasCreatedAssessments:
      assessments.length > 0,

    hasAnyScore,

    isCalculated,

    isFullyComplete,

    /*
      Legacy sequence-null assessments count as created.
    */
    createdCount:
      assessments.length,

    availableSlotCount:
      Math.max(
        0,

        maximumSlots -
        assessments.length,
      ),

    recordedCount:
      recordedAssessments.length,

    missingScoreCount:
      assessments.filter(
        (assessment) =>
          !assessment.hasScore,
      ).length,

    duplicateSequences:
      duplicates,

    invalidSequences:
      invalidSequenceRecords.map(
        (record) =>
          record.sequence,
      ),

    legacyUnsequencedCount:
      assessments.filter(
        (assessment) =>
          assessment
            .isLegacyUnsequenced,
      ).length,

    exceedsMaximum,

    hasInvalidHps,

    hasInvalidScore,

    totalScoreRaw:
      hasAnyScore
        ? totalScoreRaw
        : null,

    totalScore:
      hasAnyScore
        ? round(
            totalScoreRaw,
            2,
          )
        : null,

    totalHps:
      totalHps > 0
        ? totalHps
        : null,

    percentageScoreRaw,

    percentageScore:
      percentageScoreRaw ===
      null
        ? null
        : round(
            percentageScoreRaw,
            2,
          ),

    weightedScoreRaw,

    weightedScore:
      weightedScoreRaw ===
      null
        ? null
        : round(
            weightedScoreRaw,
            2,
          ),

    assessments,
  };
}


/*
  ============================================================
  WRITTEN / ORAL WORKS
  ============================================================
*/

export function calculateWrittenWorks(
  records,
) {
  return calculateFixedAggregateCategory({
    records,

    category:
      GRADING_CATEGORIES
        .WRITTEN_WORK,

    weight:
      (currentRules().writtenWorkWeight / 100),
  });
}


/*
  ============================================================
  PRODUCT / PERFORMANCE TASKS
  ============================================================
*/

export function calculatePerformanceTasks(
  records,
) {
  return calculateFixedAggregateCategory({
    records,

    category:
      GRADING_CATEGORIES
        .PERFORMANCE_TASK,

    weight:
      (currentRules().performanceTaskWeight / 100),
  });
}


/*
  ============================================================
  EXAMINATION COMPONENT
  ============================================================

  Strict slots:

      ST1 = sequence 1
      ST2 = sequence 2
      TE  = sequence 1 under term_exam

  Unlike WW/PT, a legacy null sequence cannot safely be guessed
  here because ST1 and ST2 use different fixed roles.
*/

export function calculateExaminationGrade(
  records,
) {
  const summativeRecords =
    records.filter(
      (record) =>
        record.category ===
        GRADING_CATEGORIES
          .SUMMATIVE_TEST,
    );

  const termExamRecords =
    records.filter(
      (record) =>
        record.category ===
        GRADING_CATEGORIES
          .TERM_EXAM,
    );

  /*
    Only correctly slotted ST assessments.
  */
  const validSummativeRecords =
    summativeRecords.filter(
      (record) =>
        isValidAssessmentSequence(
          GRADING_CATEGORIES
            .SUMMATIVE_TEST,

          record.sequence,
        ),
    );

  const invalidSummativeRecords =
    summativeRecords.filter(
      (record) =>
        !isValidAssessmentSequence(
          GRADING_CATEGORIES
            .SUMMATIVE_TEST,

          record.sequence,
        ),
    );

  /*
    Term Exam should be sequence 1.

    For backward compatibility, if an old Term Exam record
    somehow has sequence null but there is only one, recognize
    it as TE. This is safe because there is only one TE role.
  */

  const validExamRecords =
    termExamRecords.filter(
      (record) =>
        isValidAssessmentSequence(
          GRADING_CATEGORIES
            .TERM_EXAM,

          record.sequence,
        ),
    );

  const legacyNullExamRecords =
    termExamRecords.filter(
      (record) =>
        record.sequence === null ||
        record.sequence === undefined ||
        record.sequence === "",
    );

  const genuinelyInvalidExamRecords =
    termExamRecords.filter(
      (record) =>
        record.sequence !== null &&
        record.sequence !== undefined &&
        record.sequence !== "" &&
        !isValidAssessmentSequence(
          GRADING_CATEGORIES
            .TERM_EXAM,

          record.sequence,
        ),
    );

  const duplicateSummativeSequences =
    findDuplicateSequences(
      validSummativeRecords,
    );

  const duplicateExamSequences =
    findDuplicateSequences(
      validExamRecords,
    );

  const st1Record =
    validSummativeRecords.find(
      (record) =>
        Number(
          record.sequence,
        ) === 1,
    ) ?? null;

  const st2Record =
    validSummativeRecords.find(
      (record) =>
        Number(
          record.sequence,
        ) === 2,
    ) ?? null;

  /*
    Prefer proper TE sequence 1.

    Otherwise allow exactly one legacy null-sequence TE.
  */

  let termExamRecord =
    validExamRecords.find(
      (record) =>
        Number(
          record.sequence,
        ) === 1,
    ) ??
    null;

  if (
    !termExamRecord &&
    legacyNullExamRecords.length === 1
  ) {
    termExamRecord = {
      ...legacyNullExamRecords[0],

      effectiveSequence:
        1,

      isLegacyUnsequenced:
        true,
    };
  }

  function buildExamItem(
    record,
    label,
    internalWeight,
    category,
    expectedSequence,
  ) {
    if (!record) {
      return {
        label,

        exists:
          false,

        assessmentId:
          null,

        name:
          null,

        sequence:
          expectedSequence,

        slotLabel:
          getAssessmentSlotLabel(
            category,
            expectedSequence,
          ),

        score:
          null,

        totalItems:
          null,

        validHps:
          false,

        hasScore:
          false,

        scoreWithinRange:
          false,

        percentageScoreRaw:
          null,

        percentageScore:
          null,

        internalWeight,

        internalWeightedRaw:
          null,

        internalWeighted:
          null,
      };
    }

    const validHps =
      isValidHps(
        record.totalItems,
      );

    const hasScore =
      isValidNumericScore(
        record.score,
      );

    /*
      If assessment exists but learner score is blank, Excel
      arithmetic uses zero contribution while storage stays
      null.
    */
    const calculationScore =
      hasScore
        ? Number(
            record.score,
          )
        : 0;

    const scoreWithinRange =
      validHps &&
      calculationScore >= 0 &&
      calculationScore <=
        Number(
          record.totalItems,
        );

    const percentageScoreRaw =
      validHps &&
      scoreWithinRange
        ? (
            calculationScore /
            Number(
              record.totalItems,
            )
          ) *
          100
        : null;

    const internalWeightedRaw =
      percentageScoreRaw ===
      null
        ? null
        : percentageScoreRaw *
          internalWeight;

    return {
      label,

      exists:
        true,

      assessmentId:
        record.assessmentId,

      name:
        record.name,

      sequence:
        record.sequence ??
        expectedSequence,

      effectiveSequence:
        record.effectiveSequence ??
        expectedSequence,

      slotLabel:
        getAssessmentSlotLabel(
          category,
          expectedSequence,
        ),

      isLegacyUnsequenced:
        Boolean(
          record.isLegacyUnsequenced,
        ),

      /*
        Preserve actual blank/null.
      */
      score:
        hasScore
          ? Number(
              record.score,
            )
          : null,

      totalItems:
        record.totalItems,

      validHps,

      hasScore,

      scoreWithinRange,

      percentageScoreRaw,

      percentageScore:
        percentageScoreRaw ===
        null
          ? null
          : round(
              percentageScoreRaw,
              2,
            ),

      internalWeight,

      internalWeightedRaw,

      internalWeighted:
        internalWeightedRaw ===
        null
          ? null
          : round(
              internalWeightedRaw,
              2,
            ),
    };
  }

  const summativeTest1 =
    buildExamItem(
      st1Record,

      "Summative Test 1",

      EXAMINATION_INTERNAL_WEIGHTS
        .summative_test_1,

      GRADING_CATEGORIES
        .SUMMATIVE_TEST,

      1,
    );

  const summativeTest2 =
    buildExamItem(
      st2Record,

      "Summative Test 2",

      EXAMINATION_INTERNAL_WEIGHTS
        .summative_test_2,

      GRADING_CATEGORIES
        .SUMMATIVE_TEST,

      2,
    );

  const termExam =
    buildExamItem(
      termExamRecord,

      "Term Examination",

      EXAMINATION_INTERNAL_WEIGHTS
        .term_exam,

      GRADING_CATEGORIES
        .TERM_EXAM,

      1,
    );

  /*
    ==========================================================
    STRUCTURAL VALIDITY
    ==========================================================
  */

  const allAssessmentsExist =
    summativeTest1.exists &&
    summativeTest2.exists &&
    termExam.exists;

  const allHpsValid =
    summativeTest1.validHps &&
    summativeTest2.validHps &&
    termExam.validHps;

  const hasAnyScore =
    summativeTest1.hasScore ||
    summativeTest2.hasScore ||
    termExam.hasScore;

  const noDuplicateSlots =
    duplicateSummativeSequences
      .length === 0 &&
    duplicateExamSequences
      .length === 0;

  /*
    Null-sequence ST is NOT accepted because we cannot safely
    distinguish ST1 from ST2.

    A single null-sequence TE is accepted because TE has only
    one possible role.
  */

  const noInvalidSlots =
    invalidSummativeRecords.length ===
      0 &&
    genuinelyInvalidExamRecords.length ===
      0 &&
    legacyNullExamRecords.length <=
      1;

  /*
    ==========================================================
    EXAM CALCULATION
    ==========================================================

    All ST1/ST2/TE assessments/HPS must exist before EX_PS/WS
    can calculate.

    A blank learner score on an existing ST/TE contributes 0.
  */

  const isCalculated =
    allAssessmentsExist &&
    allHpsValid &&
    hasAnyScore &&
    noDuplicateSlots &&
    noInvalidSlots &&
    summativeTest1
      .scoreWithinRange &&
    summativeTest2
      .scoreWithinRange &&
    termExam
      .scoreWithinRange;

  const isFullyComplete =
    allAssessmentsExist &&
    allHpsValid &&
    noDuplicateSlots &&
    noInvalidSlots &&
    summativeTest1.hasScore &&
    summativeTest2.hasScore &&
    termExam.hasScore &&
    summativeTest1
      .scoreWithinRange &&
    summativeTest2
      .scoreWithinRange &&
    termExam
      .scoreWithinRange;

  const percentageScoreRaw =
    isCalculated
      ? (
          summativeTest1
            .percentageScoreRaw *
          EXAMINATION_INTERNAL_WEIGHTS
            .summative_test_1
        ) +
        (
          summativeTest2
            .percentageScoreRaw *
          EXAMINATION_INTERNAL_WEIGHTS
            .summative_test_2
        ) +
        (
          termExam
            .percentageScoreRaw *
          EXAMINATION_INTERNAL_WEIGHTS
            .term_exam
        )
      : null;

  const weightedScoreRaw =
    percentageScoreRaw ===
    null
      ? null
      : percentageScoreRaw *
        (currentRules().examinationWeight / 100);

  const createdCount = [
    summativeTest1,
    summativeTest2,
    termExam,
  ].filter(
    (assessment) =>
      assessment.exists,
  ).length;

  const recordedCount = [
    summativeTest1,
    summativeTest2,
    termExam,
  ].filter(
    (assessment) =>
      assessment.hasScore,
  ).length;

  /*
    ==========================================================
    STATUS
    ==========================================================
  */

  let status =
    "NOT_STARTED";

  if (
    createdCount > 0
  ) {
    status =
      "PARTIAL";
  }

  if (
    isCalculated
  ) {
    status =
      "CALCULATED";
  }

  if (
    isFullyComplete
  ) {
    status =
      "COMPLETE";
  }

  if (
    !noDuplicateSlots ||
    !noInvalidSlots
  ) {
    status =
      "INVALID";
  }

  return {
    category:
      "examination",

    label:
      "Summative Tests and Term Examination",

    weight:
      (currentRules().examinationWeight / 100),

    status,

    maximumSlots:
      3,

    allAssessmentsExist,

    allHpsValid,

    hasAnyScore,

    /*
      Used as the Excel-style Initial/Term Grade gate.
    */
    hasTermExamScore:
      termExam.hasScore,

    isCalculated,

    isFullyComplete,

    createdCount,

    recordedCount,

    missingScoreCount:
      3 - recordedCount,

    duplicateSummativeSequences,

    duplicateExamSequences,

    invalidSummativeSequences:
      invalidSummativeRecords.map(
        (record) =>
          record.sequence,
      ),

    invalidExamSequences:
      genuinelyInvalidExamRecords.map(
        (record) =>
          record.sequence,
      ),

    legacyTermExamRecognized:
      Boolean(
        termExam
          .isLegacyUnsequenced,
      ),

    percentageScoreRaw,

    percentageScore:
      percentageScoreRaw ===
      null
        ? null
        : round(
            percentageScoreRaw,
            2,
          ),

    weightedScoreRaw,

    weightedScore:
      weightedScoreRaw ===
      null
        ? null
        : round(
            weightedScoreRaw,
            2,
          ),

    summativeTest1,

    summativeTest2,

    termExam,
  };
}


/*
  Backward-compatible alias.
*/

export const calculateSummativeAndExam =
  calculateExaminationGrade;


/*
  ============================================================
  INITIAL GRADE
  ============================================================

  Excel behavior:

      Initial Grade =
          SUM(
              available WW weighted score,
              available PT weighted score,
              available Examination weighted score
          )

  If a component WS is blank, Excel SUM simply contributes
  nothing from that component.

  Term Exam learner score remains the gate for displaying the
  official Initial Grade and Term Grade.
*/

export function calculateInitialGrade(
  records,
) {
  const normalizedRecords =
    Array.isArray(records)
      ? records
          .map(
            normalizeGradeRecord,
          )
          .filter(Boolean)
      : [];

  const writtenWorks =
    calculateWrittenWorks(
      normalizedRecords,
    );

  const performanceTasks =
    calculatePerformanceTasks(
      normalizedRecords,
    );

  const examination =
    calculateExaminationGrade(
      normalizedRecords,
    );

  /*
    ==========================================================
    AVAILABLE COMPONENT CONTRIBUTIONS
    ==========================================================
  */

  const availableWeightedScores = [
    writtenWorks
      .weightedScoreRaw,

    performanceTasks
      .weightedScoreRaw,

    examination
      .weightedScoreRaw,
  ].filter(
    (value) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(
        Number(value),
      ),
  );

  /*
    Excel SUM.

    If nothing is available, running total is 0.
  */

  const runningInitialGradeRaw =
    availableWeightedScores.reduce(
      (
        total,
        value,
      ) =>
        total +
        Number(value),

      0,
    );

  /*
    ==========================================================
    TERM EXAM GATE
    ==========================================================
  */

  const hasTermExamScore =
    examination
      .hasTermExamScore;

  const initialGradeRaw =
    hasTermExamScore
      ? runningInitialGradeRaw
      : null;

  /*
    ==========================================================
    TRUE UNDERLYING COMPLETENESS
    ==========================================================

    WW/PT:

      Only created assessments need scores.

      Unused WW/PT slots do not make the term incomplete.

    Examination:

      ST1/ST2/TE must all exist and have scores.
  */

  const writtenWorksComplete =
    !writtenWorks
      .hasCreatedAssessments ||
    writtenWorks
      .isFullyComplete;

  const performanceTasksComplete =
    !performanceTasks
      .hasCreatedAssessments ||
    performanceTasks
      .isFullyComplete;

  const isFullyComplete =
    writtenWorksComplete &&
    performanceTasksComplete &&
    examination
      .isFullyComplete;

  /*
    ==========================================================
    STATUS
    ==========================================================
  */

  const hasAnyCreatedAssessment =
    writtenWorks
      .hasCreatedAssessments ||
    performanceTasks
      .hasCreatedAssessments ||
    examination
      .createdCount > 0;

  let status =
    "NOT_STARTED";

  if (
    hasAnyCreatedAssessment
  ) {
    status =
      "ONGOING";
  }

  if (
    hasTermExamScore
  ) {
    status =
      isFullyComplete
        ? "COMPLETE"
        : "PARTIAL";
  }

  return {
    status,

    writtenWorks,

    performanceTasks,

    examination,

    /*
      Backward compatibility.
    */
    summativeAndExam:
      examination,

    hasTermExamScore,

    runningInitialGradeRaw,

    runningInitialGrade:
      round(
        runningInitialGradeRaw,
        2,
      ),

    initialGradeRaw,

    initialGrade:
      initialGradeRaw ===
      null
        ? null
        : round(
            initialGradeRaw,
            2,
          ),

    isFullyComplete,

    createdAssessmentCounts: {
      writtenWorks:
        writtenWorks
          .createdCount,

      performanceTasks:
        performanceTasks
          .createdCount,

      summativeTest1:
        examination
          .summativeTest1
          .exists
          ? 1
          : 0,

      summativeTest2:
        examination
          .summativeTest2
          .exists
          ? 1
          : 0,

      termExam:
        examination
          .termExam
          .exists
          ? 1
          : 0,
    },

    maximumAssessmentCounts: {
      writtenWorks:
        5,

      performanceTasks:
        3,

      summativeTests:
        2,

      termExam:
        1,
    },
  };
}


/*
  ============================================================
  TRANSMUTATION
  ============================================================
*/

export function transmuteInitialGrade(
  initialGrade,
) {
  if (
    initialGrade === null ||
    initialGrade === undefined ||
    initialGrade === ""
  ) {
    return null;
  }

  const numericGrade =
    Number(initialGrade);

  if (
    !Number.isFinite(
      numericGrade,
    ) ||
    numericGrade < 0 ||
    numericGrade > 100
  ) {
    return null;
  }

  /*
    Approximate/lower-bound lookup.

    Equivalent conceptually to:

        VLOOKUP(..., TRUE)

    Choose the highest lower-bound that does not exceed the
    Initial Grade.
  */

  let result =
    TRANSMUTATION_TABLE[
      0
    ].grade;

  for (
    const range
    of TRANSMUTATION_TABLE
  ) {
    if (
      numericGrade >=
      range.min
    ) {
      result =
        range.grade;
    } else {
      break;
    }
  }

  return result;
}


/*
  Backward compatibility.
*/

export const transmuteGrade =
  transmuteInitialGrade;


/*
  ============================================================
  ECR DESCRIPTOR
  ============================================================
*/

export function getGradeDescriptor(
  grade,
) {
  if (
    grade === null ||
    grade === undefined ||
    grade === ""
  ) {
    return null;
  }

  const numericGrade =
    Number(grade);

  if (
    !Number.isFinite(
      numericGrade,
    )
  ) {
    return null;
  }

  if (
    numericGrade >= 90
  ) {
    return "Advancing";
  }

  if (
    numericGrade >= 80
  ) {
    return "Benchmarking";
  }

  if (
    numericGrade >= 75
  ) {
    return "Connecting";
  }

  if (
    numericGrade >= 65
  ) {
    return "Developing";
  }

  return "Emerging";
}


/*
  ============================================================
  PASS / FAIL REMARK
  ============================================================
*/

export function getGradeRemark(
  grade,
) {
  if (
    grade === null ||
    grade === undefined ||
    grade === ""
  ) {
    return null;
  }

  const numericGrade =
    Number(grade);

  if (
    !Number.isFinite(
      numericGrade,
    )
  ) {
    return null;
  }

  return numericGrade >=
    currentRules().passingGrade
    ? "PASSED"
    : "FAILED";
}


/*
  ============================================================
  EDU LITE SUPPORT CLASSIFICATION
  ============================================================
*/

export function getSupportClassification(
  grade,
) {
  if (
    grade === null ||
    grade === undefined ||
    grade === ""
  ) {
    return null;
  }

  const numericGrade =
    Number(grade);

  if (
    !Number.isFinite(
      numericGrade,
    )
  ) {
    return null;
  }

  if (
    numericGrade <
    currentRules().passingGrade
  ) {
    return "At Risk";
  }

  if (
    numericGrade >=
    currentRules().highPerformingGrade
  ) {
    return "High Performing";
  }

  return "Within Expected Range";
}


/*
  ============================================================
  TERM GRADE
  ============================================================

  A Term Grade can appear before the underlying term is fully
  complete, matching the reference Excel ECR.

  Gate:

      Term Exam learner score must exist.

  Once it exists:

      current Initial Grade
          ↓
      Transmutation
          ↓
      Term Grade
          ↓
      Descriptor
          ↓
      Support Classification
*/

export function calculateTermGrade(
  records,
  term,
) {
  const numericTerm =
    Number(term);

  if (
    !TERM_NUMBERS.includes(
      numericTerm,
    )
  ) {
    return {
      term:
        numericTerm,

      status:
        "INVALID",

      termGradeStatus:
        "INVALID",

      isComplete:
        false,

      isFullyComplete:
        false,

      isCalculable:
        false,

      hasTermGrade:
        false,

      runningInitialGrade:
        null,

      initialGrade:
        null,

      termGrade:
        null,

      descriptor:
        null,

      remark:
        null,

      supportClassification:
        null,

      error:
        "Term must be 1, 2, or 3.",
    };
  }

  /*
    ==========================================================
    NORMALIZE + ISOLATE TERM
    ==========================================================
  */

  const normalizedRecords =
    Array.isArray(records)
      ? records
          .map(
            normalizeGradeRecord,
          )
          .filter(Boolean)
      : [];

  const termRecords =
    normalizedRecords.filter(
      (record) =>
        record.term ===
        numericTerm,
    );

  const calculation =
    calculateInitialGrade(
      termRecords,
    );

  /*
    ==========================================================
    BEFORE TERM EXAM SCORE
    ==========================================================

    Running contribution may exist internally, but Excel
    Initial Grade and Term Grade remain blank.
  */

  if (
    !calculation
      .hasTermExamScore
  ) {
    return {
      term:
        numericTerm,

      status:
        calculation.status,

      termGradeStatus:
        "PENDING",

      isComplete:
        false,

      isFullyComplete:
        calculation
          .isFullyComplete,

      isCalculable:
        false,

      hasTermGrade:
        false,

      runningInitialGrade:
        calculation
          .runningInitialGrade,

      initialGrade:
        null,

      termGrade:
        null,

      descriptor:
        null,

      remark:
        null,

      supportClassification:
        null,

      createdAssessmentCounts:
        calculation
          .createdAssessmentCounts,

      maximumAssessmentCounts:
        calculation
          .maximumAssessmentCounts,

      components: {
        writtenWorks:
          calculation
            .writtenWorks,

        performanceTasks:
          calculation
            .performanceTasks,

        examination:
          calculation
            .examination,

        summativeAndExam:
          calculation
            .examination,
      },
    };
  }

  /*
    ==========================================================
    TERM EXAM SCORE EXISTS
    ==========================================================

    Use current Initial Grade, even if term is partial.
  */

  const termGrade =
    transmuteInitialGrade(
      calculation
        .initialGradeRaw,
    );

  if (
    termGrade === null
  ) {
    return {
      term:
        numericTerm,

      status:
        "ERROR",

      termGradeStatus:
        "ERROR",

      isComplete:
        false,

      isFullyComplete:
        calculation
          .isFullyComplete,

      isCalculable:
        false,

      hasTermGrade:
        false,

      runningInitialGrade:
        calculation
          .runningInitialGrade,

      initialGrade:
        calculation
          .initialGrade,

      termGrade:
        null,

      descriptor:
        null,

      remark:
        null,

      supportClassification:
        null,

      createdAssessmentCounts:
        calculation
          .createdAssessmentCounts,

      maximumAssessmentCounts:
        calculation
          .maximumAssessmentCounts,

      components: {
        writtenWorks:
          calculation
            .writtenWorks,

        performanceTasks:
          calculation
            .performanceTasks,

        examination:
          calculation
            .examination,

        summativeAndExam:
          calculation
            .examination,
      },

      error:
        "Unable to transmute the current Initial Grade.",
    };
  }

  /*
    ==========================================================
    TERM GRADE AVAILABLE
    ==========================================================

    Existing Dashboard code uses isComplete to decide whether
    a grade should be displayed.

    Therefore:

      isComplete = Term Grade exists

    Underlying assessment completion is kept separately as:

      isFullyComplete
  */

  return {
    term:
      numericTerm,

    status:
      calculation
        .isFullyComplete
        ? "COMPLETE"
        : "PARTIAL",

    termGradeStatus:
      calculation
        .isFullyComplete
        ? "COMPLETE"
        : "PARTIAL",

    /*
      Term Grade exists.
    */
    isComplete:
      true,

    /*
      Actual assessment-data completeness.
    */
    isFullyComplete:
      calculation
        .isFullyComplete,

    isCalculable:
      true,

    hasTermGrade:
      true,

    runningInitialGrade:
      calculation
        .runningInitialGrade,

    initialGrade:
      calculation
        .initialGrade,

    termGrade,

    descriptor:
      getGradeDescriptor(
        termGrade,
      ),

    remark:
      getGradeRemark(
        termGrade,
      ),

    supportClassification:
      getSupportClassification(
        termGrade,
      ),

    createdAssessmentCounts:
      calculation
        .createdAssessmentCounts,

    maximumAssessmentCounts:
      calculation
        .maximumAssessmentCounts,

    components: {
      writtenWorks:
        calculation
          .writtenWorks,

      performanceTasks:
        calculation
          .performanceTasks,

      examination:
        calculation
          .examination,

      summativeAndExam:
        calculation
          .examination,
    },
  };
}


/*
  ============================================================
  ALL TERMS
  ============================================================
*/

export function calculateAllTerms(
  records,
) {
  return {
    term1:
      calculateTermGrade(
        records,
        1,
      ),

    term2:
      calculateTermGrade(
        records,
        2,
      ),

    term3:
      calculateTermGrade(
        records,
        3,
      ),
  };
}


/*
  ============================================================
  FINAL SUBJECT GRADE
  ============================================================

  Final Grade uses TRANSMUTED Term Grades.

  NOT Initial Grades.

      Final Average =
          (T1 + T2 + T3) / 3

      Final Grade =
          round to whole number
*/

export function calculateFinalGrade(
  term1Grade,
  term2Grade,
  term3Grade,
  {
    allTermsFullyComplete = false,
  } = {},
) {
  const rawGrades = [
    term1Grade,
    term2Grade,
    term3Grade,
  ];

  /*
    Need all three displayed Term Grades.
  */

  if (
    rawGrades.some(
      (grade) =>
        grade === null ||
        grade === undefined ||
        grade === "",
    )
  ) {
    return {
      status:
        "PENDING",

      isComplete:
        false,

      isFullyComplete:
        false,

      finalAverageRaw:
        null,

      finalAverage:
        null,

      finalGrade:
        null,

      descriptor:
        null,

      remark:
        null,

      supportClassification:
        null,
    };
  }

  const grades =
    rawGrades.map(Number);

  if (
    grades.some(
      (grade) =>
        !Number.isFinite(
          grade,
        ),
    )
  ) {
    return {
      status:
        "INVALID",

      isComplete:
        false,

      isFullyComplete:
        false,

      finalAverageRaw:
        null,

      finalAverage:
        null,

      finalGrade:
        null,

      descriptor:
        null,

      remark:
        null,

      supportClassification:
        null,
    };
  }

  const finalAverageRaw =
    (
      grades[0] +
      grades[1] +
      grades[2]
    ) /
    3;

  const finalGrade =
    Math.round(
      finalAverageRaw,
    );

  return {
    status:
      allTermsFullyComplete
        ? "COMPLETE"
        : "PARTIAL",

    /*
      Final Grade exists.
    */
    isComplete:
      true,

    /*
      All underlying terms genuinely complete.
    */
    isFullyComplete:
      allTermsFullyComplete,

    termGrades: {
      term1:
        grades[0],

      term2:
        grades[1],

      term3:
        grades[2],
    },

    finalAverageRaw,

    finalAverage:
      round(
        finalAverageRaw,
        2,
      ),

    /*
      Compatibility with earlier frontend/backend code.
    */
    unroundedAverage:
      round(
        finalAverageRaw,
        2,
      ),

    finalGrade,

    descriptor:
      getGradeDescriptor(
        finalGrade,
      ),

    remark:
      getGradeRemark(
        finalGrade,
      ),

    supportClassification:
      getSupportClassification(
        finalGrade,
      ),
  };
}


/*
  ============================================================
  COMPLETE STUDENT + SUBJECT RESULT
  ============================================================
*/

export function calculateStudentSubjectGrade(
  records,
) {
  const terms =
    calculateAllTerms(
      records,
    );

  /*
    Final Grade can appear once all three displayed Term Grades
    exist.
  */

  const allTermGradesAvailable =
    terms.term1
      .hasTermGrade &&
    terms.term2
      .hasTermGrade &&
    terms.term3
      .hasTermGrade;

  /*
    Separate true assessment completion.
  */

  const allTermsFullyComplete =
    terms.term1
      .isFullyComplete &&
    terms.term2
      .isFullyComplete &&
    terms.term3
      .isFullyComplete;

  const final =
    allTermGradesAvailable
      ? calculateFinalGrade(
          terms.term1
            .termGrade,

          terms.term2
            .termGrade,

          terms.term3
            .termGrade,

          {
            allTermsFullyComplete,
          },
        )
      : {
          status:
            "PENDING",

          isComplete:
            false,

          isFullyComplete:
            false,

          finalAverageRaw:
            null,

          finalAverage:
            null,

          finalGrade:
            null,

          descriptor:
            null,

          remark:
            null,

          supportClassification:
            null,
        };

  return {
    terms,

    final,

    /*
      Grade result availability.
    */
    isComplete:
      allTermGradesAvailable &&
      final.isComplete,

    /*
      Actual underlying completion.
    */
    isFullyComplete:
      allTermsFullyComplete &&
      final.isFullyComplete,
  };
}


/*
  ============================================================
  DEFAULT EXPORT
  ============================================================
*/

const grading = {
  TERM_NUMBERS,

  GRADING_CATEGORIES,

  CATEGORY_LABELS,

  ASSESSMENT_SLOT_LIMITS,

  COMPONENT_WEIGHTS,

  EXAMINATION_INTERNAL_WEIGHTS,

  PASSING_GRADE,

  HIGH_PERFORMING_GRADE,

  TRANSMUTATION_TABLE,

  round,

  isValidNumericScore,

  isValidHps,

  isValidAssessmentSequence,

  getAssessmentSlotLabel,

  normalizeGradeRecord,

  calculatePercentageScore,

  calculateAssessmentPercentage,

  calculateWeightedScore,

  calculateWrittenWorks,

  calculatePerformanceTasks,

  calculateExaminationGrade,

  calculateSummativeAndExam,

  calculateInitialGrade,

  transmuteInitialGrade,

  transmuteGrade,

  getGradeDescriptor,

  getGradeRemark,

  getSupportClassification,

  calculateTermGrade,

  calculateAllTerms,

  calculateFinalGrade,

  calculateStudentSubjectGrade,
};

export default grading;
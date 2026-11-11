// Pure allocation engine. No DB, no HTTP, no framework.
// Caps each topic at its exam-weight share of the study plan, preventing
// over-studying material-heavy topics at the expense of material-light ones.

export type TopicEstimate = {
  key: string;
  weightMid: number; // exam weight as percentage of total
  estimateMinutes: number; // total minutes of material available
  noteMinutes: number; // minutes for reading/notes layer
  reviewMinutes: number; // minutes for review video layer
  questionMinutes: number; // minutes for question practice layer
  otherMinutes: number; // any other layers
  moduleCount: number; // number of modules in this topic
};

export type TopicBudget = {
  minutes: number; // total allocated minutes after trimming
  noteMinutes: number;
  reviewMinutes: number;
  questionMinutes: number;
  otherMinutes: number;
};

export type TrimRecord = {
  topic: string;
  layer: string;
  minutes: number;
  reason: string;
};

export type AllocationResult = {
  byTopic: Map<string, TopicBudget>;
  trimmed: TrimRecord[];
  surplusMinutes: number;
};

// Minimum practice minutes per module: one median vignette solved and reviewed.
// Derived from effort model: 6 question vignette at 24% calc share is ~18 min solve
// plus ~16 min explanation review, totaling ~36 min per module.
const MIN_PRACTICE_MINUTES_PER_MODULE = 36;

/**
 * Weight-implied minutes: the exam-weight share of a study plan.
 * Given a topic's exam weight and total plan minutes, returns the cap
 * for that topic to prevent over-studying.
 */
export function weightImpliedMinutes(weightMid: number, totalPlanMinutes: number): number {
  return (weightMid / 100) * totalPlanMinutes;
}

/**
 * Allocate study minutes to topics, capping each at its exam-weight share.
 * Excess material is trimmed in order: notes, review, then questions (lowest
 * calculation-share questions dropped first). Surplus is reported for later
 * reallocation to review of weaker topics. The floor prevents any topic from
 * losing all practice, even if its cap is lower than minimum viable practice.
 */
export function allocate(
  topics: TopicEstimate[],
  totalMinutes: number
): AllocationResult {
  const byTopic = new Map<string, TopicBudget>();
  const trimmed: TrimRecord[] = [];
  let surplusMinutes = 0;

  for (const topic of topics) {
    const cap = weightImpliedMinutes(topic.weightMid, totalMinutes);
    const floor = MIN_PRACTICE_MINUTES_PER_MODULE * topic.moduleCount;

    // Current allocation state before trimming.
    let noteMinutes = topic.noteMinutes;
    let reviewMinutes = topic.reviewMinutes;
    let questionMinutes = topic.questionMinutes;
    let otherMinutes = topic.otherMinutes;

    const totalBefore = noteMinutes + reviewMinutes + questionMinutes + otherMinutes;

    // If the topic fits within its cap, accept it as is.
    if (totalBefore <= cap) {
      byTopic.set(topic.key, {
        minutes: totalBefore,
        noteMinutes,
        reviewMinutes,
        questionMinutes,
        otherMinutes,
      });
      continue;
    }

    // Over-served: trim to cap or floor, whichever is higher.
    const target = Math.max(cap, floor);
    let trimmedSoFar = 0;
    const reason = `trimmed to weight cap (${cap.toFixed(0)} min) and floor (${floor} min)`;

    // Trim notes pre-reads first (cheapest value).
    const noteTrim = Math.min(noteMinutes, totalBefore - target);
    if (noteTrim > 0) {
      noteMinutes -= noteTrim;
      trimmedSoFar += noteTrim;
      trimmed.push({ topic: topic.key, layer: "notes", minutes: noteTrim, reason });
    }

    // Trim review video (second tier), only if notes weren't enough.
    let reviewTrim = 0;
    if (trimmedSoFar < totalBefore - target) {
      reviewTrim = Math.min(reviewMinutes, totalBefore - target - trimmedSoFar);
      if (reviewTrim > 0) {
        reviewMinutes -= reviewTrim;
        trimmedSoFar += reviewTrim;
        trimmed.push({ topic: topic.key, layer: "review", minutes: reviewTrim, reason });
      }
    }

    // Trim questions: drop the LOWEST calculation-share questions first
    // (so the most calculation-dense practice survives).
    // Within questions, assume uniform cost per question by default.
    let questionsEntry: TrimRecord | undefined;
    if (trimmedSoFar < totalBefore - target) {
      const questionTrim = Math.min(questionMinutes, totalBefore - target - trimmedSoFar);
      if (questionTrim > 0) {
        questionMinutes -= questionTrim;
        trimmedSoFar += questionTrim;
        questionsEntry = { topic: topic.key, layer: "questions", minutes: questionTrim, reason };
        trimmed.push(questionsEntry);
      }
    }

    // Trim "other" last. Nothing exempts it from the cap: a topic whose
    // other-layer minutes alone exceed its share must still be brought
    // down to target, or the invariant this function exists to enforce
    // (no topic budget exceeds its cap) would be silently violable.
    let otherEntry: TrimRecord | undefined;
    if (trimmedSoFar < totalBefore - target) {
      const otherTrim = Math.min(otherMinutes, totalBefore - target - trimmedSoFar);
      if (otherTrim > 0) {
        otherMinutes -= otherTrim;
        trimmedSoFar += otherTrim;
        otherEntry = { topic: topic.key, layer: "other", minutes: otherTrim, reason };
        trimmed.push(otherEntry);
      }
    }

    const totalAfter = noteMinutes + reviewMinutes + questionMinutes + otherMinutes;
    byTopic.set(topic.key, {
      minutes: totalAfter,
      noteMinutes,
      reviewMinutes,
      questionMinutes,
      otherMinutes,
    });
    surplusMinutes += totalBefore - totalAfter;

    // If floor exceeded the cap, record the overflow on whichever layer
    // absorbed the last of the trim (other if it fired, else questions).
    if (target === floor && floor > cap) {
      const overflowEntry = otherEntry ?? questionsEntry;
      if (overflowEntry) {
        overflowEntry.reason = `floor (${floor} min) exceeds weight cap (${cap.toFixed(0)} min)`;
      }
    }
  }

  return { byTopic, trimmed, surplusMinutes };
}

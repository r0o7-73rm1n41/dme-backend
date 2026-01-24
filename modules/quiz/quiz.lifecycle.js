// modules/quiz/quiz.lifecycle.js
import Quiz from "./quiz.model.js";
import ObservabilityService from "../monitoring/observability.service.js";

export const QUIZ_STATES = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  LOCKED: "LOCKED",
  LIVE: "LIVE",
  ENDED: "ENDED",
  RESULT_PUBLISHED: "RESULT_PUBLISHED"
};

export const QUIZ_TRANSITIONS = {
  [QUIZ_STATES.DRAFT]: [QUIZ_STATES.SCHEDULED, QUIZ_STATES.LOCKED],
  [QUIZ_STATES.SCHEDULED]: [QUIZ_STATES.LOCKED, QUIZ_STATES.LIVE],
  [QUIZ_STATES.LOCKED]: [QUIZ_STATES.LIVE],
  [QUIZ_STATES.LIVE]: [QUIZ_STATES.ENDED],
  [QUIZ_STATES.ENDED]: [QUIZ_STATES.RESULT_PUBLISHED]
};

export async function canTransition(quizDate, fromState, toState) {
  // If fromState is provided, use it; otherwise get current state from DB
  if (!fromState) {
    const quiz = await Quiz.findOne({ quizDate });
    if (!quiz) return false;
    fromState = quiz.state;
  }

  // Check if the transition is allowed in the rules
  return QUIZ_TRANSITIONS[fromState]?.includes(toState);
}

export async function transitionQuiz(quizDate, toState) {
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) throw new Error("Quiz not found");

  const fromState = quiz.state;
  const allowedTransitions = QUIZ_TRANSITIONS[quiz.state] || [];
  if (!allowedTransitions.includes(toState)) {
    throw new Error(`Invalid transition from ${quiz.state} to ${toState}`);
  }

  quiz.state = toState;

  // Map state transitions to timestamp fields
  const timestampFields = {
    [QUIZ_STATES.LOCKED]: 'lockedAt',
    [QUIZ_STATES.LIVE]: 'liveAt',
    [QUIZ_STATES.ENDED]: 'endedAt',
    [QUIZ_STATES.RESULT_PUBLISHED]: 'resultPublishedAt'
  };

  const timestampField = timestampFields[toState];
  if (timestampField) {
    quiz[timestampField] = new Date();
  }

  await quiz.save();

  // Record state change for observability
  await ObservabilityService.recordQuizStateChange(quizDate, fromState, toState, {
    timestampField,
    transitionedAt: quiz[timestampField]
  });

  // Emit socket event for all quiz state changes
  if (global.io) {
    global.io.to(`quiz-${quizDate}`).emit('quiz-state-changed', { 
      quizDate, 
      fromState, 
      toState, 
      timestamp: new Date().toISOString(),
      transitionedAt: quiz[timestampField]
    });
  }

  return quiz;
}

export async function getQuizState(quizDate) {
  const quiz = await Quiz.findOne({ quizDate });
  return quiz ? quiz.state : null;
}

export async function isQuizLive(quizDate) {
  return await getQuizState(quizDate) === QUIZ_STATES.LIVE;
}

export async function isQuizClosed(quizDate) {
  const state = await getQuizState(quizDate);
  return [QUIZ_STATES.ENDED, QUIZ_STATES.RESULT_PUBLISHED].includes(state);
}

export async function isQuizFinalized(quizDate) {
  return await getQuizState(quizDate) === QUIZ_STATES.RESULT_PUBLISHED;
}
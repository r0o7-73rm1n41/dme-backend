// modules/quiz/quiz.service.js
import mongoose from "mongoose";
import crypto from "crypto";
import QuizAttempt from "./quizAttempt.model.js";
import Quiz from "./quiz.model.js";
import Winner from "./winner.model.js";
import QuizProgress from "./quizProgress.model.js";
import { isUserEligible } from "../payment/payment.service.js";
import redisClient from "../../config/redis.js";
import { canTransition, transitionQuiz, isQuizLive, isQuizClosed } from "./quiz.lifecycle.js";
import { evaluateEligibility } from "../../utils/quizEligibility.js";
import ObservabilityService from "../monitoring/observability.service.js";
import { logAdminAction } from "../admin/adminAudit.service.js";
import { sendQuizCompletionNotification } from "../notification/notification.service.js";
import { updateUserStreak, getUserStreakStats } from "../user/streak.service.js";
import { evaluateEligibilityForWinners } from "./quizEligibility.js";

// Global map to store quiz advancement intervals
const quizIntervals = new Map();

// Helper functions for global current question index
export async function getCurrentQuestionIndex(quizDate) {
  const key = `quiz:${quizDate}:currentQuestionIndex`;
  const value = await redisClient.get(key);
  return value ? parseInt(value) : 0;
}

export async function setCurrentQuestionIndex(quizDate, index) {
  const key = `quiz:${quizDate}:currentQuestionIndex`;
  await redisClient.set(key, index.toString());
}

export async function setQuestionStartTime(quizDate, startTime) {
  const key = `quiz:${quizDate}:questionStartTime`;
  await redisClient.set(key, startTime.toString());
}

export async function getQuestionStartTime(quizDate) {
  const key = `quiz:${quizDate}:questionStartTime`;
  const value = await redisClient.get(key);
  return value ? parseInt(value) : Date.now();
}

// Recover quiz advancement for live quizzes on server startup
export async function recoverQuizAdvancement() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    let quiz = await Quiz.findOne({ quizDate: today });
    
    if (!quiz) {
      console.log(`No quiz found for ${today}`);
      return;
    }
    
    // Only recover advancement for quizzes that are already LIVE
    // Don't automatically start SCHEDULED quizzes on server startup
    if (quiz.state !== 'LIVE') {
      console.log(`Quiz for ${today} is in ${quiz.state} state, not starting automatically`);
      return;
    }
    
    // Quiz is already live, recover advancement
    console.log(`Recovering quiz advancement for ${today}`);
    
    // Check if advancement is already running
    if (quizIntervals.has(today)) {
      console.log(`Advancement already running for ${today}`);
      return;
    }
    
    // Get current global index
    const currentIndex = await getCurrentQuestionIndex(today);
    console.log(`Resuming advancement from question index ${currentIndex} for ${today}`);
    
    // Resume advancement
    const interval = setInterval(async () => {
      try {
        const current = await getCurrentQuestionIndex(today);
        console.log(`Quiz ${today}: Current question index: ${current}`);
        if (current < 49) {
          const nextIndex = current + 1;
          await setCurrentQuestionIndex(today, nextIndex);
          await setQuestionStartTime(today, Date.now());
          console.log(`Quiz ${today}: Advanced to question index: ${nextIndex}`);
          // Emit to quiz room clients
          if (global.io) {
            global.io.to(`quiz-${today}`).emit('question-advanced', { 
              quizDate: today, 
              currentQuestionIndex: nextIndex,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          console.log(`Quiz ${today}: Reached final question, stopping advancement`);
          // Quiz finished advancing - end the quiz
          clearInterval(interval);
          quizIntervals.delete(today);
          
          // End the quiz automatically when it reaches the final question
          try {
            await endQuiz(today);
            console.log(`Quiz ${today}: Automatically ended after reaching final question`);
          } catch (error) {
            console.error(`Error ending quiz ${today}:`, error);
          }
        }
      } catch (error) {
        console.error('Error advancing question:', error);
      }
    }, 15000);
    
    quizIntervals.set(today, interval);
    console.log(`Quiz advancement recovered for ${today}`);
  } catch (error) {
    console.error('Error recovering quiz advancement:', error);
  }
}



// Fisher-Yates shuffle algorithm for secure randomization
function shuffleArray(array, seed) {
  const shuffled = [...array];
  // Use crypto-based RNG seeded with userId + quizDate for deterministic per-user shuffling
  const random = () => {
    // Create deterministic but seemingly random sequence per user
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function createQuizAttempt(userId, quizDate, deviceInfo = {}) {
  try {
    // Check if user already has an attempt
    const existingAttempt = await QuizAttempt.findOne({ user: userId, quizDate });
    if (existingAttempt) {
      // If attempt exists and is not completed, allow resuming
      if (!existingAttempt.answersSaved) {
        return existingAttempt;
      }
      throw new Error('You have already started this quiz. Please complete it or wait for the next quiz.');
    }

    // Get quiz to shuffle questions
    const quiz = await Quiz.findOne({ quizDate });
    if (!quiz) {
      throw new Error('Quiz not found for today');
    }

    // Create deterministic seed from userId (string hash)
    const userIdStr = userId.toString();
    const seed = userIdStr.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    // Shuffle questions per user (deterministic but different per user)
    const shuffledIndices = shuffleArray(
      quiz.questions.map((_, i) => i),
      seed
    );

    // Store shuffled question order in attempt
    const attempt = new QuizAttempt({
      user: userId,
      quizDate,
      answers: [],
      score: 0,
      totalTimeMs: 0,
      isEligible: false, // Will be set properly during finalization
      counted: false, // Will be set during finalization
      answersSaved: false,
      questionOrder: shuffledIndices, // Store the shuffled order
      deviceId: deviceInfo.deviceId,
      deviceFingerprint: deviceInfo.deviceFingerprint,
      ipAddress: deviceInfo.ipAddress
    });

    // Set current question index to global current
    const globalCurrentIndex = await getCurrentQuestionIndex(quizDate);
    attempt.currentQuestionIndex = globalCurrentIndex;
    console.log(`Creating attempt for user ${userId}, setting currentQuestionIndex to global current: ${globalCurrentIndex}`);

    await attempt.save();
    return attempt;
  } catch (error) {
    console.error('Error creating quiz attempt:', error);
    throw error;
  }
}

export async function finalizeQuizAttempt(userId, quizDate) {
  try {
    const attempt = await QuizAttempt.findOne({ user: userId, quizDate });
    if (!attempt) {
      throw new Error('No attempt found');
    }
    if (attempt.answersSaved) {
      throw new Error('Quiz attempt already finalized');
    }

    const quiz = await Quiz.findOne({ quizDate }).populate('questions');
    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Apply eligibility centrally FIRST
    const [user, payment] = await Promise.all([
      mongoose.model('User').findById(userId),
      mongoose.model('Payment').findOne({ user: userId, quizDate, status: 'SUCCESS' })
    ]);

    const eligibility = evaluateEligibility({ user, payment, quiz });

    // Calculate score - but set to 0 if not eligible
    // Map shuffled answers back to original question order
    let score = 0;
    if (eligibility.eligible) {
      const questionOrder = attempt.questionOrder || quiz.questions.map((_, i) => i);
      const optionOrders = attempt.optionOrders || [];
      
      quiz.questions.forEach((originalQuestion, originalIndex) => {
        // Find which shuffled question index this original question is at
        const shuffledIndex = questionOrder.indexOf(originalIndex);
        
        if (shuffledIndex >= 0 && attempt.answers[shuffledIndex] !== undefined) {
          // Get shuffled answer
          const shuffledAnswer = attempt.answers[shuffledIndex];
          
          // Map shuffled answer back to original option index
          if (optionOrders[shuffledIndex] && optionOrders[shuffledIndex].length === 4) {
            const originalAnswerIndex = optionOrders[shuffledIndex][shuffledAnswer];
            if (originalAnswerIndex === originalQuestion.correctIndex) {
              score++;
            }
          } else {
            // Fallback: if no option order, assume answer is already in original order
            if (shuffledAnswer === originalQuestion.correctIndex) {
              score++;
            }
          }
        }
      });
    }

    attempt.score = score;
    attempt.answersSaved = true;
    attempt.isEligible = eligibility.eligible;
    attempt.counted = eligibility.eligible;
    attempt.eligibilityReason = eligibility.reason;
    attempt.eligibilitySnapshotAt = new Date();
    attempt.completedAt = new Date();

    await attempt.save();

    // Send quiz completion notification
    try {
      await sendQuizCompletionNotification(userId, {
        score: attempt.score,
        totalQuestions: quiz.questions.length,
        counted: attempt.counted,
        quizDate
      });
    } catch (notificationError) {
      console.error('Failed to send quiz completion notification:', notificationError);
      // Don't fail quiz finalization if notification fails
    }

    return attempt;
  } catch (error) {
    console.error('Error finalizing quiz attempt:', error);
    throw error;
  }
}

export async function getLeaderboard(quizDate) {
  try {
    // Global eligibility enforcement: only show leaderboard if quiz has ended
    if (!(await isQuizClosed(quizDate))) {
      throw new Error('Leaderboard not available until quiz ends');
    }

    // Check cache first for better performance
    const cacheKey = `leaderboard:${quizDate}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('Redis cache read failed:', error.message);
    }

    // Serve leaderboard from immutable Winners collection (read model)
    // This ensures consistency and prevents re-evaluation of attempts
    const winners = await Winner.find({ quizDate })
      .sort({ rank: 1 }) // Winners are already ranked
      .populate('user', 'name phone profilePicture')
      .select('user rank score totalTimeMs');

    // Cache for 30 minutes (leaderboard doesn't change after quiz ends)
    try {
      await redisClient.setEx(cacheKey, 1800, JSON.stringify(winners));
    } catch (error) {
      console.warn('Redis cache write failed:', error.message);
    }

    return winners;
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    throw new Error('Failed to retrieve leaderboard');
  }
}

export async function calculateAndPersistWinners(quizDate) {
  // Skip transactions in test environment (single MongoDB instance)
  if (process.env.NODE_ENV === 'test') {
    // Idempotent: delete any existing winners first to ensure clean state
    await Winner.deleteMany({ quizDate });

    // Get quiz for snapshot
    const quiz = await Quiz.findOne({ quizDate }).populate('questions');
    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Create quiz snapshot for forensic integrity
    const quizSnapshot = {
      version: crypto.createHash('sha256').update(JSON.stringify({
        quizDate: quiz.quizDate,
        questions: quiz.questions,
        createdAt: quiz.createdAt
      })).digest('hex'),
      questionCount: quiz.questions.length,
      questionHashes: quiz.questions.map(q => 
        crypto.createHash('sha256').update(JSON.stringify({
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex
        })).digest('hex')
      ),
      createdAt: quiz.createdAt
    };

    // Read all attempts and filter using centralized eligibility
    const allAttempts = await QuizAttempt.find({
      quizDate,
      answersSaved: true
    })
      .populate('user')
      .sort({ score: -1, totalTimeMs: 1 }); // Deterministic sorting

    // Filter attempts using centralized eligibility check
    const eligibleAttempts = [];
    for (const attempt of allAttempts) {
      const payment = await mongoose.model('Payment').findOne({
        user: attempt.user._id,
        quizDate,
        status: 'SUCCESS'
      });

      const eligibility = evaluateEligibilityForWinners({
        user: attempt.user,
        payment,
        quiz,
        attempt
      });

      if (eligibility.eligible) {
        eligibleAttempts.push({
          attempt,
          payment,
          eligibilityReason: eligibility.reason
        });
      }
    }

    // Sort eligible attempts by score (descending) then by time (ascending - fastest first)
    eligibleAttempts.sort((a, b) => {
      if (b.attempt.score !== a.attempt.score) {
        return b.attempt.score - a.attempt.score; // Higher score first
      }
      return a.attempt.totalTimeMs - b.attempt.totalTimeMs; // Faster time first
    });

    const topAttempts = eligibleAttempts.slice(0, 20);

    if (!topAttempts.length) {
      return [];
    }

    const winners = topAttempts.map((eligibleAttempt, index) => {
      const attempt = eligibleAttempt.attempt;
      // Create attempt snapshot for dispute resolution
      const attemptSnapshot = {
        answersHash: crypto.createHash('sha256').update(JSON.stringify(attempt.answers)).digest('hex'),
        questionOrder: attempt.questionHashes ? attempt.questionHashes.map((_, i) => i) : [], // Sequential for now
        answerTimestamps: attempt.answerTimestamps || [],
        finalizedAt: attempt.updatedAt
      };

      return {
        quizDate,
        user: attempt.user,
        rank: index + 1,
        score: attempt.score,
        accuracy: Math.round((attempt.score / 50) * 100),
        totalTimeMs: attempt.totalTimeMs,
        quizSnapshot,
        attemptSnapshot
      };
    });

    // Insert winners
    await Winner.insertMany(winners);

    // Process referral rewards for participants
    try {
      const ReferralReward = (await import('../user/referralReward.model.js')).default;

      for (const eligibleAttempt of eligibleAttempts) {
        const user = eligibleAttempt.attempt.user;

        // Check if this user was referred and award referrer bonus
        if (user.referredBy) {
          // Award bonus entry to referrer for each successful participation by referee
          await ReferralReward.findOneAndUpdate(
            {
              referrer: user.referredBy,
              referee: user._id,
              quizDate
            },
            {
              rewardType: 'BONUS_ENTRY',
              rewardAmount: 1, // 1 bonus quiz entry
              status: 'AWARDED',
              awardedAt: new Date()
            },
            { upsert: true, new: true }
          );
        }

        // Award streak bonuses
        const streakStats = await getUserStreakStats(user._id);
        if (streakStats && streakStats.currentStreak >= 7) {
          // Weekly streak bonus
          if (streakStats.currentStreak % 7 === 0) {
            await ReferralReward.findOneAndUpdate(
              {
                referrer: user._id, // Self-reward for streak
                referee: user._id,
                quizDate
              },
              {
                rewardType: 'STREAK_BONUS',
                rewardAmount: Math.floor(streakStats.currentStreak / 7), // Bonus entries based on weeks
                status: 'AWARDED',
                awardedAt: new Date()
              },
              { upsert: true, new: true }
            );
          }
        }
      }
    } catch (error) {
      console.error('Error processing referral rewards:', error);
      // Don't fail finalization for reward processing errors
    }

    return winners;
  }

  // Production: Use transactions for safety
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Idempotent: delete any existing winners first to ensure clean state
    await Winner.deleteMany({ quizDate }, { session });

    // Get quiz for snapshot
    const quiz = await Quiz.findOne({ quizDate }, null, { session });
    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Create quiz snapshot for forensic integrity
    const quizSnapshot = {
      version: crypto.createHash('sha256').update(JSON.stringify({
        quizDate: quiz.quizDate,
        questions: quiz.questions,
        createdAt: quiz.createdAt
      })).digest('hex'),
      questionCount: quiz.questions.length,
      questionHashes: quiz.questions.map(q => 
        crypto.createHash('sha256').update(JSON.stringify({
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex
        })).digest('hex')
      ),
      createdAt: quiz.createdAt
    };

    // Read all attempts and filter using centralized eligibility
    const allAttempts = await QuizAttempt.find({
      quizDate,
      answersSaved: true
    }, null, { session })
      .populate('user')
      .sort({ score: -1, totalTimeMs: 1 }); // Deterministic sorting

    // Filter attempts using centralized eligibility check
    const eligibleAttempts = [];
    for (const attempt of allAttempts) {
      const payment = await mongoose.model('Payment').findOne({
        user: attempt.user._id,
        quizDate,
        status: 'SUCCESS'
      }, null, { session });

      const eligibility = evaluateEligibilityForWinners({
        user: attempt.user,
        payment,
        quiz,
        attempt
      });

      if (eligibility.eligible) {
        eligibleAttempts.push({
          attempt,
          payment,
          eligibilityReason: eligibility.reason
        });
      }
    }

    // Sort eligible attempts by score (descending) then by time (ascending - fastest first)
    eligibleAttempts.sort((a, b) => {
      if (b.attempt.score !== a.attempt.score) {
        return b.attempt.score - a.attempt.score; // Higher score first
      }
      return a.attempt.totalTimeMs - b.attempt.totalTimeMs; // Faster time first
    });

    const topAttempts = eligibleAttempts.slice(0, 20);

    if (!topAttempts.length) {
      await session.commitTransaction();
      session.endSession();
      return [];
    }

    const winners = topAttempts.map(({ attempt, payment, eligibilityReason }, index) => {
      // Create attempt snapshot for dispute resolution
      const attemptSnapshot = {
        answersHash: crypto.createHash('sha256').update(JSON.stringify(attempt.answers)).digest('hex'),
        questionOrder: attempt.questionHashes ? attempt.questionHashes.map((_, i) => i) : [], // Sequential for now
        answerTimestamps: attempt.answerTimestamps || [],
        finalizedAt: attempt.updatedAt,
        eligibilityReason,
        paymentId: payment ? payment._id : null,
        totalTimeMs: attempt.totalTimeMs,
        score: attempt.score
      };

      return {
        quizDate,
        user: attempt.user._id,
        rank: index + 1,
        score: attempt.score,
        totalTimeMs: attempt.totalTimeMs,
        quizSnapshot,
        attemptSnapshot,
        snapshotAt: new Date() // When this winner snapshot was created
      };
    });

    // Insert winners
    await Winner.insertMany(winners, { session });

    await session.commitTransaction();
    session.endSession();

    return winners;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

export async function finalizeWinners(quizDate) {
  const startTime = Date.now();

  // Redis fencing to prevent double finalization
  const token = await redisClient.incr(`quiz:${quizDate}:finalize`);
  if (token !== 1) {
    console.log(`Finalize already running for ${quizDate}, token: ${token}`);
    await ObservabilityService.recordRedisFencingFailure(quizDate, 'finalize');
    return;
  }

  try {
    // Ensure quiz is in CLOSED state before finalizing
    const quiz = await Quiz.findOne({ quizDate });
    if (!quiz) {
      throw new Error('Quiz not found');
    }

    if (quiz.state !== 'ENDED') {
      await transitionQuiz(quizDate, 'ENDED');
    }

    // Check if quiz can transition to FINALIZED
    if (!(await canTransition(quizDate, null, 'FINALIZED'))) {
      return;
    }

    // Calculate and persist winners using isolated function
    const winners = await calculateAndPersistWinners(quizDate);

    // Comprehensive audit logging for winners
    if (winners.length > 0) {
      // Get all attempts for detailed audit
      const allAttempts = await QuizAttempt.find({
        quizDate,
        answersSaved: true
      })
        .populate('user', 'name phone')
        .sort({ score: -1, totalTimeMs: 1 });

      const eligibleAttempts = allAttempts.filter(attempt => attempt.counted);
      const top20Attempts = eligibleAttempts.slice(0, 20);

      // Log detailed winner calculation audit
      const auditData = {
        winnerCount: winners.length,
        totalAttempts: allAttempts.length,
        eligibleAttempts: eligibleAttempts.length,
        top20Attempts: top20Attempts.map((attempt, index) => ({
          rank: index + 1,
          userId: attempt.user._id,
          userName: attempt.user.name,
          userPhone: attempt.user.phone,
          score: attempt.score,
          totalTimeMs: attempt.totalTimeMs,
          isEligible: attempt.isEligible,
          eligibilityReason: attempt.eligibilityReason,
          counted: attempt.counted
        })),
        eligibilitySnapshot: eligibleAttempts.map(attempt => ({
          userId: attempt.user._id,
          score: attempt.score,
          totalTimeMs: attempt.totalTimeMs,
          isEligible: attempt.isEligible,
          eligibilityReason: attempt.eligibilityReason,
          counted: attempt.counted
        })),
        tieBreakDecisions: top20Attempts.filter((attempt, index) => {
          if (index === 0) return false;
          const prev = top20Attempts[index - 1];
          return attempt.score === prev.score && attempt.totalTimeMs === prev.totalTimeMs;
        }).map(attempt => ({
          userId: attempt.user._id,
          score: attempt.score,
          totalTimeMs: attempt.totalTimeMs,
          resolvedBy: 'deterministic_sorting'
        })),
        calculationTimestamp: new Date(),
        fencingToken: token
      };

      await logAdminAction(null, 'WINNERS_CALCULATED', 'QUIZ', quizDate, auditData, null);
    }

    // Update streaks for all participants
    try {
      const allParticipants = await QuizAttempt.find({
        quizDate,
        answersSaved: true,
        counted: true
      }).distinct('user');

      for (const userId of allParticipants) {
        await updateUserStreak(userId, quizDate);
      }
    } catch (error) {
      console.error('Error updating streaks:', error);
      // Don't fail finalization for streak update errors
    }

    // Transition quiz state
    await transitionQuiz(quizDate, 'FINALIZED');

    // Record successful finalization latency
    const latency = Date.now() - startTime;
    await ObservabilityService.recordFinalizeLatency(quizDate, latency, true);

  } catch (error) {
    // Record failed finalization latency
    const latency = Date.now() - startTime;
    await ObservabilityService.recordFinalizeLatency(quizDate, latency, false);

    console.error('Error finalizing winners:', error);
    throw error;
  }
}

export async function getTodayQuiz(date, userId = null) {
  try {
    const quiz = await Quiz.findOne({ quizDate: date });
    
    // If user provided, check class grade matching
    if (quiz && userId && quiz.classGrade && quiz.classGrade !== 'ALL') {
      const User = (await import('../user/user.model.js')).default;
      const user = await User.findById(userId).select('class');
      if (user && user.class) {
        // Map user's class to quiz classGrade format
        const userClassGrade = user.class === '10' ? '10th' : user.class === '12' ? '12th' : 'Other';
        if (userClassGrade !== quiz.classGrade) {
          // User is not eligible for this quiz class
          return null;
        }
      }
    }
    
    return quiz;
  } catch (error) {
    console.error('Error getting today quiz:', error);
    throw error;
  }
}

// Additional functions for quiz state management

export async function getQuizStatus(quizDate, userId) {
  try {
    // Get user, payment, quiz
    const [user, payment, quiz] = await Promise.all([
      mongoose.model('User').findById(userId),
      mongoose.model('Payment').findOne({ user: userId, quizDate, status: 'SUCCESS' }),
      Quiz.findOne({ quizDate })
    ]);

    // Evaluate eligibility
    const eligibility = evaluateEligibility({ user, payment, quiz });

    // Get user's attempt if exists
    const attempt = await QuizAttempt.findOne({ user: userId, quizDate }).select('joinedAt score answersSaved answerTimestamps questionStartTimes currentQuestionIndex');

    const status = {
      eligible: eligibility.eligible,
      quiz: quiz ? {
        quizDate: quiz.quizDate,
        state: quiz.state,
        questionCount: quiz.questions ? quiz.questions.length : 0,
        startTime: new Date(`${quiz.quizDate}T20:00:00+05:30`), // 8 PM IST
        endTime: quiz.endTime,
        // DO NOT include questions in status - serve per question for security
        questions: null
      } : null,
      attempt: attempt ? {
        joined: !!attempt.joinedAt,
        completed: attempt.answersSaved,
        score: attempt.score,
        currentQuestionIndex: attempt.currentQuestionIndex
      } : null
    };

    return status;
  } catch (error) {
    console.error('Error getting quiz status:', error);
    throw error;
  }
}

export async function getNextQuestion(userId, quizDate, requestedQuestionIndex) {
  try {
    // Validate quiz is live
    if (!(await isQuizLive(quizDate))) {
      throw new Error('Quiz is not live');
    }

    // Get user's attempt
    const attempt = await QuizAttempt.findOne({ user: userId, quizDate });
    if (!attempt) {
      throw new Error('No active attempt found');
    }

    if (attempt.answersSaved) {
      throw new Error('Quiz already completed');
    }

    // Get current global question index
    const globalCurrentIndex = await getCurrentQuestionIndex(quizDate);
    console.log(`User ${userId} requesting question ${requestedQuestionIndex}, global current: ${globalCurrentIndex}, user current: ${attempt.currentQuestionIndex}`);
    
    // Update user's current question index if they're behind the global progress
    if (attempt.currentQuestionIndex < globalCurrentIndex) {
      console.log(`Updating user ${userId} currentQuestionIndex from ${attempt.currentQuestionIndex} to ${globalCurrentIndex}`);
      attempt.currentQuestionIndex = globalCurrentIndex;
      await attempt.save();
    }

    // Use the requested question index, but ensure it's not ahead of the user's current position
    let currentQuestionIndex = requestedQuestionIndex;
    
    // For live quiz, if requesting a question behind current position, jump to current position
    // This ensures late joiners start from the current question, not from the beginning
    if (currentQuestionIndex < attempt.currentQuestionIndex) {
      console.log(`User ${userId} requested question ${requestedQuestionIndex} but current is ${attempt.currentQuestionIndex}, jumping to current`);
      currentQuestionIndex = attempt.currentQuestionIndex;
    }

    // Get quiz
    const quiz = await Quiz.findOne({ quizDate }).select('questions');
    if (!quiz || !quiz.questions) {
      throw new Error('Quiz not found');
    }

    // Get shuffled question order for this user
    const questionOrder = attempt.questionOrder || quiz.questions.map((_, i) => i);
    
    // Map currentQuestionIndex to actual question index using shuffled order
    const actualQuestionIndex = questionOrder[currentQuestionIndex];
    
    // Validate question index
    if (currentQuestionIndex < 0 || currentQuestionIndex >= quiz.questions.length) {
      throw new Error('Invalid question index');
    }
    if (actualQuestionIndex < 0 || actualQuestionIndex >= quiz.questions.length) {
      throw new Error('Invalid question order');
    }

    // Check if previous question was answered (enforce sequential answering)
    // NOTE: With auto-advancement, we allow proceeding even if previous questions are unanswered
    // if (currentQuestionIndex > 0 && attempt.answers[currentQuestionIndex - 1] === undefined) {
    //   throw new Error('Previous question not answered');
    // }

    // Allow getting answered questions for viewing (unpaid users can see previous questions)
    // if (attempt.answers[currentQuestionIndex] !== undefined) {
    //   throw new Error('Question already answered');
    // }

    // Get question using shuffled order
    const actualQuestion = quiz.questions[actualQuestionIndex];
    
    // Shuffle options within the question for extra security
    const optionIndices = shuffleArray([0, 1, 2, 3], userId.toString().charCodeAt(0) + currentQuestionIndex);
    const shuffledOptions = optionIndices.map(i => actualQuestion.options[i]);
    const originalCorrectIndex = actualQuestion.correctIndex;
    const shuffledCorrectIndex = optionIndices.indexOf(originalCorrectIndex);
    
    // Store option order for this question
    if (!attempt.optionOrders) attempt.optionOrders = [];
    attempt.optionOrders[currentQuestionIndex] = optionIndices;
    
    const question = {
      _id: `${quiz._id}_${currentQuestionIndex}`,
      text: actualQuestion.question,
      options: shuffledOptions,
      originalIndex: actualQuestionIndex,
      shuffledCorrectIndex: shuffledCorrectIndex
    };

    // Generate question hash for integrity checking (use actual question text)
    const questionContent = JSON.stringify({
      question: question.text,
      options: question.options,
      index: currentQuestionIndex
    });
    const questionHash = crypto.createHash('sha256').update(questionContent).digest('hex');

    // Record question start time
    if (!attempt.questionStartTimes) attempt.questionStartTimes = [];
    if (!attempt.questionHashes) attempt.questionHashes = [];

    attempt.questionStartTimes[currentQuestionIndex] = new Date();
    attempt.questionHashes[currentQuestionIndex] = questionHash;

    await attempt.save();

    console.log(`Returning question ${currentQuestionIndex} to user ${userId}`);

    return {
      questionIndex: currentQuestionIndex,
      question: question.text, // Use text property
      options: question.options,
      questionHash,
      timeLimitMs: 15000, // 15 seconds per question
      serverTimestamp: new Date().toISOString(),
      startTime: attempt.questionStartTimes[currentQuestionIndex]?.getTime() || Date.now()
    };
  } catch (error) {
    console.error('Error getting next question:', error);
    throw error;
  }
}

export async function getUserQuizAnalytics(userId) {
  try {
    // Get all attempts for the user
    const attempts = await QuizAttempt.find({ user: userId })
      .populate('user', 'name')
      .sort({ quizDate: -1 })
      .limit(20);

    if (attempts.length === 0) {
      return {
        totalQuizzes: 0,
        averageScore: 0,
        bestRank: null,
        totalCorrect: 0,
        totalQuestions: 0,
        quizHistory: [],
        achievements: []
      };
    }

    // Calculate statistics
    const totalQuizzes = attempts.length;
    const totalScore = attempts.reduce((sum, attempt) => sum + attempt.score, 0);
    const averageScore = Math.round((totalScore / totalQuizzes) * 2); // Convert to percentage out of 50

    // Get ranks from winners collection
    const quizDates = attempts.map(a => a.quizDate);
    const winners = await Winner.find({ quizDate: { $in: quizDates } })
      .populate('user', 'name username');

    const quizHistory = attempts.map(attempt => {
      // Find winner entry for this quiz date
      const winnerEntry = winners.find(w => w.quizDate === attempt.quizDate && w.user && w.user._id.toString() === userId.toString());
      const userRank = winnerEntry ? winnerEntry.rank : null;

      return {
        date: attempt.quizDate,
        score: attempt.score,
        rank: userRank,
        timeTaken: attempt.totalTimeMs ? `${Math.round(attempt.totalTimeMs / 1000)}s` : null,
        timeSpent: attempt.totalTimeMs || 0,
        correctAnswers: attempt.score, // Assuming score = correct answers
        totalQuestions: 50, // Standard quiz has 50 questions
        counted: attempt.counted
      };
    });

    const bestRank = Math.min(...quizHistory.filter(h => h.rank).map(h => h.rank));
    const totalCorrect = attempts.reduce((sum, attempt) => sum + attempt.score, 0);
    const totalQuestions = totalQuizzes * 50; // Assuming 50 questions per quiz

    // Generate achievements
    const achievements = [];
    if (totalQuizzes >= 1) achievements.push({ icon: '🎯', title: 'First Quiz', description: 'Completed your first quiz' });
    if (averageScore >= 70) achievements.push({ icon: '🏆', title: 'High Scorer', description: 'Average score above 70%' });
    if (bestRank && bestRank <= 20) achievements.push({ icon: '⭐', title: 'Top 20', description: 'Ranked in top 20 at least once' });
    if (totalQuizzes >= 10) achievements.push({ icon: '🔥', title: 'Regular', description: 'Completed 10 quizzes' });
    if (totalCorrect >= 500) achievements.push({ icon: '🎖️', title: 'Expert', description: 'Answered 500+ questions correctly' });

    return {
      totalQuizzes,
      averageScore,
      bestRank: bestRank || null,
      totalCorrect,
      totalQuestions,
      quizHistory,
      achievements
    };
  } catch (error) {
    console.error('Error getting user quiz analytics:', error);
    throw error;
  }
}

export async function saveQuizProgress(userId, quizDate, progressData) {
  try {
    const progress = await QuizProgress.findOneAndUpdate(
      { user: userId, quizDate },
      {
        ...progressData,
        lastActivity: new Date()
      },
      { upsert: true, new: true }
    );
    return progress;
  } catch (error) {
    console.error('Error saving quiz progress:', error);
    throw error;
  }
}

export async function loadQuizProgress(userId, quizDate) {
  try {
    const progress = await QuizProgress.findOne({ user: userId, quizDate });
    return progress;
  } catch (error) {
    console.error('Error loading quiz progress:', error);
    throw error;
  }
}

export async function clearQuizProgress(userId, quizDate) {
  try {
    await QuizProgress.deleteOne({ user: userId, quizDate });
  } catch (error) {
    console.error('Error clearing quiz progress:', error);
    throw error;
  }
}

// Quiz lifecycle management functions
export async function lockQuiz(quizDate) {
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) throw new Error('Quiz not found');

  await transitionQuiz(quizDate, 'LOCKED');
  console.log(`Quiz ${quizDate} locked`);
}

export async function snapshotEligibleUsers(quizDate) {
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) throw new Error('Quiz not found');

  if (quiz.state !== 'LOCKED') {
    throw new Error('Snapshot not allowed: quiz not locked');
  }

  // Get all users who are eligible
  const User = mongoose.model('User');
  const eligibleUsers = await User.find({
    'quizEligibility.isEligible': true,
    'quizEligibility.eligibleDate': quizDate
  }).select('_id');

  quiz.eligibleUsers = eligibleUsers.map(u => u._id);
  await quiz.save();

  console.log(`[QUIZ] Eligibility snapshotted for ${quizDate}: ${eligibleUsers.length} users`);
}

export async function startQuiz(quizDate) {
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) throw new Error('Quiz not found');

  await transitionQuiz(quizDate, 'LIVE');

  // Set initial question index and start time
  await setCurrentQuestionIndex(quizDate, 0);
  await setQuestionStartTime(quizDate, Date.now());

  // Start question advancement
  const interval = setInterval(async () => {
    try {
      const current = await getCurrentQuestionIndex(quizDate);
      if (current < 49) {
        const nextIndex = current + 1;
        await setCurrentQuestionIndex(quizDate, nextIndex);
        await setQuestionStartTime(quizDate, Date.now());
        // Emit to quiz room clients
        if (global.io) {
          global.io.to(`quiz-${quizDate}`).emit('question-advanced', { 
            quizDate, 
            currentQuestionIndex: nextIndex,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        clearInterval(interval);
        quizIntervals.delete(quizDate);
      }
    } catch (error) {
      console.error('Error advancing question:', error);
    }
  }, 15000);

  quizIntervals.set(quizDate, interval);
  console.log(`Quiz ${quizDate} started`);
}

export async function endQuiz(quizDate) {
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) {
    console.log(`[QUIZ] endQuiz skipped — quiz not found for ${quizDate}`);
    return;
  }

  await transitionQuiz(quizDate, 'ENDED');

  // Stop advancement
  const interval = quizIntervals.get(quizDate);
  if (interval) {
    clearInterval(interval);
    quizIntervals.delete(quizDate);
  }

  // Evaluate winners
  await calculateAndPersistWinners(quizDate);

  console.log(`Quiz ${quizDate} ended and evaluated`);
}

export async function getCurrentQuestion(userId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const quiz = await Quiz.findOne({ quizDate: today }).populate('questions');
  if (!quiz || quiz.state !== 'LIVE') {
    throw new Error('Quiz not live');
  }

  const currentIndex = await getCurrentQuestionIndex(today);
  if (currentIndex >= quiz.questions.length) {
    throw new Error('Quiz ended');
  }

  // Get user's attempt to get shuffled question order
  const attempt = await QuizAttempt.findOne({ user: userId, quizDate: today });
  if (!attempt) {
    throw new Error('No attempt found');
  }

  const questionOrder = attempt.questionOrder || quiz.questions.map((_, i) => i);
  const actualQuestionIndex = questionOrder[currentIndex];
  const question = quiz.questions[actualQuestionIndex];

  // Shuffle options for this user and question
  const optionIndices = shuffleArray([0, 1, 2, 3], userId.toString().charCodeAt(0) + currentIndex);
  const shuffledOptions = optionIndices.map(i => question.options[i]);

  // Store option order in attempt if not already stored
  if (!attempt.optionOrders) attempt.optionOrders = [];
  if (!attempt.optionOrders[currentIndex]) {
    attempt.optionOrders[currentIndex] = optionIndices;
    await attempt.save();
  }

  // Calculate expiresAt based on stored start time
  const startTime = await getQuestionStartTime(today);
  const expiresAt = new Date(startTime + 15000); // 15 seconds from start

  return {
    questionId: question._id,
    questionIndex: currentIndex + 1, // 1-based for display
    text: question.question,
    options: shuffledOptions,
    expiresAt: expiresAt.toISOString()
  };
}

export async function submitAnswer(userId, questionId, selectedOptionIndex, deviceInfo = {}) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const quiz = await Quiz.findOne({ quizDate: today }).populate('questions');
  if (!quiz || quiz.state !== 'LIVE') {
    throw new Error('Quiz not live');
  }

  const attempt = await QuizAttempt.findOne({ user: userId, quizDate: today });
  if (!attempt) {
    throw new Error('No attempt found');
  }

  // Anti-cheat: Validate device consistency
  if (attempt.deviceId && deviceInfo.deviceId && attempt.deviceId !== deviceInfo.deviceId) {
    // Record anti-cheat event
    const ObservabilityService = (await import('../monitoring/observability.service.js')).default;
    await ObservabilityService.recordAntiCheatEvent(userId, today, 'device_mismatch', {
      expectedDeviceId: attempt.deviceId,
      providedDeviceId: deviceInfo.deviceId,
      ipAddress: deviceInfo.ipAddress
    });
    throw new Error('Device mismatch detected - possible cheating attempt');
  }
  if (attempt.deviceFingerprint && deviceInfo.deviceFingerprint && attempt.deviceFingerprint !== deviceInfo.deviceFingerprint) {
    // Record anti-cheat event
    const ObservabilityService = (await import('../monitoring/observability.service.js')).default;
    await ObservabilityService.recordAntiCheatEvent(userId, today, 'device_fingerprint_mismatch', {
      expectedFingerprint: attempt.deviceFingerprint,
      providedFingerprint: deviceInfo.deviceFingerprint,
      ipAddress: deviceInfo.ipAddress
    });
    throw new Error('Device fingerprint mismatch detected - possible cheating attempt');
  }

  // Check if user has paid for today
  const PaymentService = (await import('../payment/payment.service.js')).default;
  const hasPaid = await PaymentService.isUserEligible(userId, today);

  // Find the question by _id
  const question = quiz.questions.find(q => q._id.toString() === questionId);
  if (!question) {
    throw new Error('Question not found');
  }

  // Get the question index in the user's shuffled order
  const questionOrder = attempt.questionOrder || quiz.questions.map((_, i) => i);
  const questionIndex = questionOrder.findIndex(idx => quiz.questions[idx]._id.toString() === questionId);
  if (questionIndex === -1) {
    throw new Error('Question not in user order');
  }

  const currentIndex = await getCurrentQuestionIndex(today);
  if (questionIndex !== currentIndex) {
    throw new Error('Question mismatch - not current question');
  }

  // Check if already answered
  const progress = await QuizProgress.findOne({ user: userId, quizDate: today, 'questions.questionId': questionId });
  if (progress && progress.questions.find(q => q.questionId.toString() === questionId)?.answeredAt) {
    return { success: true, alreadyAnswered: true };
  }

  // Anti-cheat: Check timing - prevent answering too quickly (less than 2 seconds)
  const questionProgress = progress?.questions.find(q => q.questionId.toString() === questionId);
  if (questionProgress) {
    const timeSinceSent = Date.now() - new Date(questionProgress.sentAt).getTime();
    if (timeSinceSent < 2000) { // Less than 2 seconds
      // Record anti-cheat event
      const ObservabilityService = (await import('../monitoring/observability.service.js')).default;
      await ObservabilityService.recordAntiCheatEvent(userId, today, 'rapid_answer', {
        timeSinceSent,
        questionId,
        deviceInfo
      });
      throw new Error('Answer submitted too quickly - possible automated cheating');
    }
  }

  // Record answer
  const answeredAt = new Date();
  
  // Map shuffled answer back to original
  const optionOrder = attempt.optionOrders && attempt.optionOrders[questionIndex];
  let originalSelectedIndex = selectedOptionIndex;
  if (optionOrder) {
    originalSelectedIndex = optionOrder[selectedOptionIndex];
  }
  
  const isCorrect = originalSelectedIndex === question.correctIndex;

  // Only save progress if user has paid
  if (hasPaid) {
    await QuizProgress.findOneAndUpdate(
      { user: userId, quizDate: today },
      {
        $push: {
          questions: {
            questionId,
            sentAt: new Date(Date.now() - 15000), // Approximate
            answeredAt,
            isCorrect
          }
        }
      },
      { upsert: true }
    );

    // Update attempt with shuffled answer index
    attempt.answers[questionIndex] = selectedOptionIndex;
    attempt.answerTimestamps[questionIndex] = answeredAt;
    await attempt.save();
  }

  return { success: true, isCorrect, countsForScore: hasPaid };
}

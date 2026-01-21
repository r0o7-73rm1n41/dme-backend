// middlewares/rate-limit.middleware.js
/**
 * Enterprise-Grade Rate Limiting Middleware
 * 
 * Features:
 * - Redis-based distributed rate limiting
 * - Per-user and per-IP rate limits
 * - Graceful degradation when Redis unavailable
 * - Proper error messages and retry-after headers
 * - Different limits for different endpoint types
 * - Development mode disables rate limiting
 */

import redis from "../config/redis.js";

const DEFAULT_WINDOW_MS = 60000; // 1 minute
const DEFAULT_MAX_REQUESTS = 100;

/**
 * Main rate limit function factory
 */
export function rateLimit(windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS, keyPrefix = 'rate_limit') {
  return async (req, res, next) => {
    // Skip rate limiting in development
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
      return next();
    }

    try {
      // Get identifier (user ID or IP address)
      const identifier = req.user?._id?.toString() || req.ip || req.connection.remoteAddress || 'anonymous';
      const endpoint = req.originalUrl.split('?')[0];
      const rateKey = `${keyPrefix}:${identifier}:${endpoint}`;

      // Check Redis availability
      const redisAvailable = await checkRedisHealth();
      
      if (!redisAvailable) {
        // In production, fail open (allow request)
        console.warn('⚠️ Redis unavailable for rate limiting - allowing request');
        res.set('X-RateLimit-Degraded', 'true');
        return next();
      }

      // Get current request count
      const currentRequests = await Promise.race([
        redis.get(rateKey),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 500))
      ]);
      
      const requestCount = currentRequests ? parseInt(currentRequests) : 0;
      const remaining = Math.max(0, maxRequests - requestCount);
      const resetTime = new Date(Date.now() + windowMs).toISOString();

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': resetTime,
      });

      // Check if limit exceeded
      if (requestCount >= maxRequests) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.set('Retry-After', retryAfter.toString());
        
        console.warn(`⚠️ Rate limit exceeded for ${identifier} on ${endpoint}`);
        
        return res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          retryAfter,
          timestamp: new Date().toISOString(),
        });
      }

      // Increment counter
      await Promise.race([
        redis.set(rateKey, requestCount + 1, 'PX', windowMs),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 500))
      ]);

      next();
    } catch (error) {
      console.error('❌ Rate limiting error:', error.message);
      // Fail open in case of error
      return next();
    }
  };
}

/**
 * Check Redis health with timeout
 */
async function checkRedisHealth() {
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 500))
    ]);
    return true;
  } catch (error) {
    console.warn('⚠️ Redis health check failed:', error.message);
    return false;
  }
}

/**
 * Production-ready rate limiters with proper categorization
 */

// AUTH ENDPOINTS - Strict limits to prevent brute force
export const authRateLimit = rateLimit(15 * 60 * 1000, 5, 'auth'); // 5 attempts per 15 minutes per IP

// READ ENDPOINTS - Lenient for user experience
export const readRateLimit = rateLimit(60 * 1000, 300, 'read'); // 300 requests per minute

// WRITE ENDPOINTS - Moderate limits
export const writeRateLimit = rateLimit(60 * 1000, 100, 'write'); // 100 requests per minute

// QUIZ ENDPOINTS - Specific limits
export const quizAttemptRateLimit = rateLimit(60 * 60 * 1000, 1, 'quiz_attempt'); // 1 quiz attempt per hour per user
export const quizListRateLimit = rateLimit(60 * 1000, 60, 'quiz_list'); // 60 requests per minute

// BLOG ENDPOINTS - Balanced limits
export const blogViewRateLimit = rateLimit(60 * 1000, 200, 'blog_view'); // 200 blog views per minute
export const blogListRateLimit = rateLimit(60 * 1000, 200, 'blog_list'); // 200 list requests per minute

// FILE UPLOAD - Strict to prevent abuse
export const fileUploadRateLimit = rateLimit(60 * 60 * 1000, 10, 'file_upload'); // 10 uploads per hour

// PAYMENT - Very strict
export const paymentRateLimit = rateLimit(60 * 1000, 5, 'payment'); // 5 payment requests per minute

// REPORT - Moderate to prevent spam
export const reportRateLimit = rateLimit(60 * 60 * 1000, 20, 'report'); // 20 reports per hour

// GENERAL API - Fallback limit
export const generalRateLimit = rateLimit(60 * 1000, 200, 'general'); // 200 requests per minute
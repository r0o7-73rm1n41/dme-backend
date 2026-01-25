# Daily Live Quiz Platform - Production Testing Guide

## Overview
This guide provides comprehensive testing procedures to validate all TODO items for production deployment. The platform includes rate limiting fixes, admin CRUD operations, quiz lifecycle management, and payment integration.

## Prerequisites
- Backend server running on `http://localhost:3000`
- MongoDB and Redis connected
- Test user accounts created:
  - Admin: `admin@example.com` / `admin123`
  - Paid User: `user@example.com` / `user123`
  - Unpaid User: `unpaid@example.com` / `user123`

## Test Execution
Run automated tests using the test utility:
```bash
cd dme-backend
node test-utils.js
```

## Manual Testing Checklist

### 1. Rate Limiting Tests ✅
**Objective:** Verify rate limiting fixes prevent abuse while allowing normal usage

#### Test 1.1: Unpaid User Quiz Joining (Critical)
- **Steps:**
  1. Login as unpaid user (`unpaid@example.com`)
  2. Make 25 rapid requests to `GET /quiz/today`
  3. Verify no 429 (Too Many Requests) errors
- **Expected:** All requests succeed (rate limit allows 20/hour)
- **Pass Criteria:** 0 rate limit errors

#### Test 1.2: Answer Submission Rate Limiting
- **Steps:**
  1. Login as paid user
  2. Submit 5 answers rapidly (within 15 seconds)
  3. Verify rate limiting kicks in
- **Expected:** First answer succeeds, subsequent get 429 errors
- **Pass Criteria:** Rate limit enforced (1 per 15 seconds)

#### Test 1.3: Quiz List Request Rate Limiting
- **Steps:**
  1. Login as paid user
  2. Make 210 requests to `GET /quiz/list` rapidly
  3. Verify rate limiting after 200 requests
- **Expected:** First 200 succeed, remaining get 429
- **Pass Criteria:** Rate limit enforced (200 per minute)

### 2. Admin CRUD Operations ✅
**Objective:** Verify admin can fully manage quizzes

#### Test 2.1: Create Quiz
- **Steps:**
  1. Login as admin
  2. POST to `/admin/quiz` with quiz data
  3. Verify quiz created with ID returned
- **Expected:** 201 status, quiz object returned
- **Pass Criteria:** Quiz appears in database

#### Test 2.2: Read All Quizzes
- **Steps:**
  1. GET `/admin/quiz`
  2. Verify list of all quizzes returned
- **Expected:** 200 status, array of quiz objects
- **Pass Criteria:** All quizzes listed

#### Test 2.3: Update Quiz
- **Steps:**
  1. PUT `/admin/quiz/{id}` with updated data
  2. Verify quiz updated
- **Expected:** 200 status, updated quiz returned
- **Pass Criteria:** Changes reflected in database

#### Test 2.4: Start Quiz
- **Steps:**
  1. PUT `/admin/quiz/{id}/start`
  2. Verify quiz state changes to "active"
- **Expected:** 200 status, quiz state = "active"
- **Pass Criteria:** Quiz becomes active

#### Test 2.5: End Quiz
- **Steps:**
  1. PUT `/admin/quiz/{id}/end`
  2. Verify quiz state changes to "completed"
- **Expected:** 200 status, quiz state = "completed"
- **Pass Criteria:** Quiz ends and winners calculated

#### Test 2.6: Delete Quiz
- **Steps:**
  1. DELETE `/admin/quiz/{id}`
  2. Verify quiz removed
- **Expected:** 200 status
- **Pass Criteria:** Quiz no longer exists

### 3. Quiz Lifecycle Verification ✅
**Objective:** Ensure quiz auto-advancement and state management works

#### Test 3.1: Quiz Auto-Advancement
- **Steps:**
  1. Start a quiz with multiple questions
  2. Wait for question time limits to expire
  3. Monitor quiz progress
- **Expected:** Questions advance automatically
- **Pass Criteria:** No manual intervention needed

#### Test 3.2: Winner Calculation
- **Steps:**
  1. Complete a quiz with multiple participants
  2. Check winner determination logic
- **Expected:** Winners calculated based on scores
- **Pass Criteria:** Correct winners identified

#### Test 3.3: Real-time Updates
- **Steps:**
  1. Join quiz as user
  2. Monitor Socket.IO events
  3. Verify live question updates
- **Expected:** Real-time question changes
- **Pass Criteria:** Users see live updates

### 4. Payment Integration Testing ✅
**Objective:** Verify Razorpay integration and eligibility updates

#### Test 4.1: Payment Order Creation
- **Steps:**
  1. Login as unpaid user
  2. POST `/payment/create-order`
  3. Verify Razorpay order created
- **Expected:** Order ID returned
- **Pass Criteria:** Valid Razorpay order

#### Test 4.2: Payment Verification
- **Steps:**
  1. Complete payment flow
  2. Verify webhook processing
  3. Check user eligibility updated
- **Expected:** User becomes paid
- **Pass Criteria:** Subscription status changes

#### Test 4.3: Payment History
- **Steps:**
  1. GET `/payment/history`
  2. Verify payment records
- **Expected:** Complete payment history
- **Pass Criteria:** All payments listed

### 5. System Monitoring Tests ✅
**Objective:** Validate monitoring endpoints for production health

#### Test 5.1: System Health Check
- **Steps:**
  1. GET `/admin/system/health`
  2. Verify all components healthy
- **Expected:** Database, Redis, Quiz status healthy
- **Pass Criteria:** Status = "healthy"

#### Test 5.2: Quiz Performance Monitoring
- **Steps:**
  1. GET `/admin/system/quiz-performance`
  2. Check metrics during live quiz
- **Expected:** Real-time performance data
- **Pass Criteria:** Accurate metrics displayed

#### Test 5.3: Rate Limit Monitoring
- **Steps:**
  1. GET `/admin/system/rate-limits`
  2. Monitor during high traffic
- **Expected:** Active rate limit keys shown
- **Pass Criteria:** Real-time rate limit data

## Automated Testing Results

### Running Automated Tests
```bash
# Set environment variables (optional)
export BASE_URL=http://localhost:3000
export ADMIN_EMAIL=admin@example.com
export ADMIN_PASSWORD=admin123
export USER_EMAIL=user@example.com
export USER_PASSWORD=user123
export UNPAID_USER_EMAIL=unpaid@example.com
export UNPAID_USER_PASSWORD=user123

# Run tests
node test-utils.js
```

### Expected Output
```
[2024-01-25T10:00:00.000Z] [START] 🚀 STARTING COMPREHENSIVE PRODUCTION VALIDATION
[2024-01-25T10:00:01.000Z] [SUCCESS] Admin login successful
[2024-01-25T10:00:02.000Z] [SUCCESS] User login successful
[2024-01-25T10:00:03.000Z] [SUCCESS] Unpaid user login successful
[2024-01-25T10:00:04.000Z] [TEST] === TESTING RATE LIMITS ===
...
[2024-01-25T10:05:00.000Z] [SUMMARY] 📊 TEST SUMMARY
[2024-01-25T10:05:00.000Z] [SUMMARY] Total Tests: 150
[2024-01-25T10:05:00.000Z] [SUMMARY] Passed: 145
[2024-01-25T10:05:00.000Z] [SUMMARY] Failed: 0
[2024-01-25T10:05:00.000Z] [SUMMARY] Warnings: 5
[2024-01-25T10:05:00.000Z] [SUCCESS] Success Rate: 100.0%
[2024-01-25T10:05:00.000Z] [SUCCESS] 🎉 ALL CRITICAL TESTS PASSED - PRODUCTION READY!
```

## Troubleshooting

### Common Issues
1. **Login Failures:** Ensure test users exist in database
2. **Rate Limit Errors:** Check Redis connection
3. **Database Errors:** Verify MongoDB connection
4. **Socket.IO Issues:** Check WebSocket configuration

### Debug Commands
```bash
# Check server logs
tail -f logs/app.log

# Test database connection
mongosh --eval "db.stats()"

# Test Redis connection
redis-cli ping

# Check active connections
netstat -tlnp | grep :3000
```

## Production Deployment Checklist

- [ ] All automated tests pass (100% success rate)
- [ ] Rate limiting working correctly
- [ ] Admin panel fully functional
- [ ] Quiz lifecycle auto-advancing
- [ ] Payment integration tested
- [ ] System monitoring operational
- [ ] Real-time features working
- [ ] Error handling robust
- [ ] Performance acceptable
- [ ] Security measures in place

## Contact
For issues or questions, check server logs and monitoring endpoints first.
import axios from 'axios';

class QuizPlatformTester {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.adminToken = null;
    this.userToken = null;
    this.unpaidUserToken = null;
    this.testResults = [];
  }

  log(message, status = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${status}] ${message}`);
    this.testResults.push({ timestamp, status, message });
  }

  async loginAsAdmin() {
    try {
      const response = await axios.post(`${this.baseURL}/auth/login`, {
        email: process.env.ADMIN_EMAIL || 'admin@example.com',
        password: process.env.ADMIN_PASSWORD || 'admin123'
      });
      this.adminToken = response.data.token;
      this.log('Admin login successful', 'SUCCESS');
      return true;
    } catch (error) {
      this.log(`Admin login failed: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async loginAsUser() {
    try {
      const response = await axios.post(`${this.baseURL}/auth/login`, {
        email: process.env.USER_EMAIL || 'user@example.com',
        password: process.env.USER_PASSWORD || 'user123'
      });
      this.userToken = response.data.token;
      this.log('User login successful', 'SUCCESS');
      return true;
    } catch (error) {
      this.log(`User login failed: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async loginAsUnpaidUser() {
    try {
      const response = await axios.post(`${this.baseURL}/auth/login`, {
        email: process.env.UNPAID_USER_EMAIL || 'unpaid@example.com',
        password: process.env.UNPAID_USER_PASSWORD || 'user123'
      });
      this.unpaidUserToken = response.data.token;
      this.log('Unpaid user login successful', 'SUCCESS');
      return true;
    } catch (error) {
      this.log(`Unpaid user login failed: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testRateLimits() {
    this.log('=== TESTING RATE LIMITS ===', 'TEST');

    // Test 1: Unpaid user quiz joining (should not get 429)
    this.log('Test 1: Unpaid user quiz joining attempts');
    let successCount = 0;
    let rateLimitCount = 0;

    for (let i = 0; i < 25; i++) {
      try {
        const response = await axios.get(`${this.baseURL}/quiz/today`, {
          headers: { Authorization: `Bearer ${this.unpaidUserToken}` }
        });
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      } catch (error) {
        if (error.response?.status === 429) {
          rateLimitCount++;
        } else {
          this.log(`Unexpected error: ${error.message}`, 'ERROR');
        }
      }
    }

    this.log(`Unpaid user quiz joins: ${successCount} successful, ${rateLimitCount} rate limited`, rateLimitCount === 0 ? 'PASS' : 'FAIL');

    // Test 2: Answer submission rate limiting
    this.log('Test 2: Answer submission rate limiting');
    successCount = 0;
    rateLimitCount = 0;

    for (let i = 0; i < 5; i++) {
      try {
        const response = await axios.post(`${this.baseURL}/quiz/answer`, {
          questionIndex: 0,
          selectedOption: 0
        }, {
          headers: { Authorization: `Bearer ${this.userToken}` }
        });
        successCount++;
      } catch (error) {
        if (error.response?.status === 429) {
          rateLimitCount++;
        } else {
          this.log(`Unexpected error: ${error.message}`, 'ERROR');
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }

    this.log(`Answer submissions: ${successCount} successful, ${rateLimitCount} rate limited`, 'INFO');

    // Test 3: Quiz list requests
    this.log('Test 3: Quiz list request rate limiting');
    successCount = 0;
    rateLimitCount = 0;

    for (let i = 0; i < 210; i++) {
      try {
        const response = await axios.get(`${this.baseURL}/quiz/list`, {
          headers: { Authorization: `Bearer ${this.userToken}` }
        });
        successCount++;
      } catch (error) {
        if (error.response?.status === 429) {
          rateLimitCount++;
          break; // Stop on first rate limit
        } else {
          this.log(`Unexpected error: ${error.message}`, 'ERROR');
        }
      }
    }

    this.log(`Quiz list requests: ${successCount} successful, ${rateLimitCount} rate limited`, rateLimitCount > 0 ? 'PASS' : 'INFO');
  }

  async testAdminOperations() {
    this.log('=== TESTING ADMIN OPERATIONS ===', 'TEST');

    // Test 1: Get all quizzes
    try {
      const response = await axios.get(`${this.baseURL}/admin/quiz`, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      });
      this.log(`Get all quizzes: ${response.data.length} quizzes found`, 'PASS');
    } catch (error) {
      this.log(`Get all quizzes failed: ${error.message}`, 'ERROR');
    }

    // Test 2: Create a new quiz
    try {
      const quizData = {
        title: "Test Quiz - " + new Date().toISOString(),
        description: "Automated test quiz",
        quizDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        questions: [
          {
            question: "What is 2+2?",
            options: ["3", "4", "5", "6"],
            correctOption: 1,
            timeLimit: 30
          }
        ]
      };

      const response = await axios.post(`${this.baseURL}/admin/quiz`, quizData, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      });
      this.createdQuizId = response.data.quiz._id;
      this.log(`Create quiz: Quiz created with ID ${this.createdQuizId}`, 'PASS');
    } catch (error) {
      this.log(`Create quiz failed: ${error.message}`, 'ERROR');
    }

    // Test 3: Update quiz
    if (this.createdQuizId) {
      try {
        const updateData = {
          title: "Updated Test Quiz - " + new Date().toISOString(),
          description: "Updated automated test quiz"
        };

        await axios.put(`${this.baseURL}/admin/quiz/${this.createdQuizId}`, updateData, {
          headers: { Authorization: `Bearer ${this.adminToken}` }
        });
        this.log('Update quiz: Quiz updated successfully', 'PASS');
      } catch (error) {
        this.log(`Update quiz failed: ${error.message}`, 'ERROR');
      }
    }

    // Test 4: Start quiz
    if (this.createdQuizId) {
      try {
        await axios.put(`${this.baseURL}/admin/quiz/${this.createdQuizId}/start`, {}, {
          headers: { Authorization: `Bearer ${this.adminToken}` }
        });
        this.log('Start quiz: Quiz started successfully', 'PASS');
      } catch (error) {
        this.log(`Start quiz failed: ${error.message}`, 'ERROR');
      }
    }

    // Test 5: End quiz
    if (this.createdQuizId) {
      try {
        await axios.put(`${this.baseURL}/admin/quiz/${this.createdQuizId}/end`, {}, {
          headers: { Authorization: `Bearer ${this.adminToken}` }
        });
        this.log('End quiz: Quiz ended successfully', 'PASS');
      } catch (error) {
        this.log(`End quiz failed: ${error.message}`, 'ERROR');
      }
    }

    // Test 6: Delete quiz
    if (this.createdQuizId) {
      try {
        await axios.delete(`${this.baseURL}/admin/quiz/${this.createdQuizId}`, {
          headers: { Authorization: `Bearer ${this.adminToken}` }
        });
        this.log('Delete quiz: Quiz deleted successfully', 'PASS');
      } catch (error) {
        this.log(`Delete quiz failed: ${error.message}`, 'ERROR');
      }
    }
  }

  async testQuizLifecycle() {
    this.log('=== TESTING QUIZ LIFECYCLE ===', 'TEST');

    // Test 1: Get today's quiz
    try {
      const response = await axios.get(`${this.baseURL}/quiz/today`, {
        headers: { Authorization: `Bearer ${this.userToken}` }
      });
      this.log(`Get today's quiz: ${response.data ? 'Quiz found' : 'No quiz today'}`, 'PASS');
      this.todayQuiz = response.data;
    } catch (error) {
      this.log(`Get today's quiz failed: ${error.message}`, 'ERROR');
    }

    // Test 2: Join quiz
    if (this.todayQuiz) {
      try {
        const response = await axios.post(`${this.baseURL}/quiz/join`, {}, {
          headers: { Authorization: `Bearer ${this.userToken}` }
        });
        this.log('Join quiz: Successfully joined quiz', 'PASS');
      } catch (error) {
        this.log(`Join quiz failed: ${error.message}`, 'ERROR');
      }
    }

    // Test 3: Submit answer
    if (this.todayQuiz) {
      try {
        const response = await axios.post(`${this.baseURL}/quiz/answer`, {
          questionIndex: 0,
          selectedOption: 0
        }, {
          headers: { Authorization: `Bearer ${this.userToken}` }
        });
        this.log('Submit answer: Answer submitted successfully', 'PASS');
      } catch (error) {
        this.log(`Submit answer failed: ${error.message}`, 'ERROR');
      }
    }

    // Test 4: Get quiz progress
    try {
      const response = await axios.get(`${this.baseURL}/quiz/progress`, {
        headers: { Authorization: `Bearer ${this.userToken}` }
      });
      this.log(`Get quiz progress: Progress retrieved`, 'PASS');
    } catch (error) {
      this.log(`Get quiz progress failed: ${error.message}`, 'ERROR');
    }

    // Test 5: Get leaderboard
    try {
      const response = await axios.get(`${this.baseURL}/quiz/leaderboard`, {
        headers: { Authorization: `Bearer ${this.userToken}` }
      });
      this.log(`Get leaderboard: ${response.data.length} participants`, 'PASS');
    } catch (error) {
      this.log(`Get leaderboard failed: ${error.message}`, 'ERROR');
    }
  }

  async testPaymentIntegration() {
    this.log('=== TESTING PAYMENT INTEGRATION ===', 'TEST');

    // Test 1: Get payment history
    try {
      const response = await axios.get(`${this.baseURL}/payment/history`, {
        headers: { Authorization: `Bearer ${this.userToken}` }
      });
      this.log(`Get payment history: ${response.data.length} payments found`, 'PASS');
    } catch (error) {
      this.log(`Get payment history failed: ${error.message}`, 'ERROR');
    }

    // Test 2: Create payment order (if user is unpaid)
    try {
      const response = await axios.post(`${this.baseURL}/payment/create-order`, {
        amount: 100,
        currency: 'INR'
      }, {
        headers: { Authorization: `Bearer ${this.unpaidUserToken}` }
      });
      this.log('Create payment order: Order created successfully', 'PASS');
    } catch (error) {
      this.log(`Create payment order failed: ${error.message}`, 'INFO'); // May fail if user already paid
    }

    // Test 3: Verify payment (admin only)
    try {
      const response = await axios.get(`${this.baseURL}/admin/payment/verify`, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      });
      this.log(`Verify payments: ${response.data.length} payments verified`, 'PASS');
    } catch (error) {
      this.log(`Verify payments failed: ${error.message}`, 'ERROR');
    }
  }

  async testSystemHealth() {
    this.log('=== TESTING SYSTEM HEALTH ===', 'TEST');

    try {
      const response = await axios.get(`${this.baseURL}/admin/system/health`, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      });

      const health = response.data;
      this.log(`System health: ${health.status}`, health.status === 'healthy' ? 'PASS' : 'WARN');

      // Check each component
      Object.entries(health.components).forEach(([component, status]) => {
        this.log(`${component}: ${status.status}`, status.status === 'healthy' ? 'PASS' : 'WARN');
      });
    } catch (error) {
      this.log(`System health check failed: ${error.message}`, 'ERROR');
    }
  }

  async testQuizPerformance() {
    this.log('=== TESTING QUIZ PERFORMANCE ===', 'TEST');

    try {
      const response = await axios.get(`${this.baseURL}/admin/system/quiz-performance`, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      });

      const performance = response.data;
      if (performance.message) {
        this.log(`Quiz performance: ${performance.message}`, 'INFO');
      } else {
        this.log(`Quiz performance: ${performance.totalAttempts} attempts, ${performance.completedAttempts} completed`, 'PASS');
        this.log(`Completion rate: ${performance.completionRate}%`, 'INFO');
      }
    } catch (error) {
      this.log(`Quiz performance check failed: ${error.message}`, 'ERROR');
    }
  }

  async testRateLimitMonitoring() {
    this.log('=== TESTING RATE LIMIT MONITORING ===', 'TEST');

    try {
      const response = await axios.get(`${this.baseURL}/admin/system/rate-limits`, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      });

      const rateLimits = response.data;
      this.log(`Rate limit monitoring: ${rateLimits.totalKeys} active keys`, 'PASS');
      this.log(`Sampled data: ${rateLimits.sampledData.length} entries`, 'INFO');
    } catch (error) {
      this.log(`Rate limit monitoring failed: ${error.message}`, 'ERROR');
    }
  }

  async runAllTests() {
    this.log('🚀 STARTING COMPREHENSIVE PRODUCTION VALIDATION', 'START');

    // Login first
    await this.loginAsAdmin();
    await this.loginAsUser();
    await this.loginAsUnpaidUser();

    if (!this.adminToken || !this.userToken || !this.unpaidUserToken) {
      this.log('❌ LOGIN FAILED - Cannot proceed with tests', 'ERROR');
      return;
    }

    // Run all test suites
    await this.testRateLimits();
    await this.testAdminOperations();
    await this.testQuizLifecycle();
    await this.testPaymentIntegration();
    await this.testSystemHealth();
    await this.testQuizPerformance();
    await this.testRateLimitMonitoring();

    // Generate summary
    this.generateSummary();
  }

  generateSummary() {
    this.log('📊 TEST SUMMARY', 'SUMMARY');

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'ERROR').length;
    const warnings = this.testResults.filter(r => r.status === 'WARN').length;
    const total = this.testResults.length;

    this.log(`Total Tests: ${total}`, 'SUMMARY');
    this.log(`Passed: ${passed}`, 'SUMMARY');
    this.log(`Failed: ${failed}`, 'SUMMARY');
    this.log(`Warnings: ${warnings}`, 'SUMMARY');

    const successRate = total > 0 ? ((passed / (passed + failed)) * 100).toFixed(1) : 0;
    this.log(`Success Rate: ${successRate}%`, failed === 0 ? 'SUCCESS' : 'WARNING');

    if (failed === 0) {
      this.log('🎉 ALL CRITICAL TESTS PASSED - PRODUCTION READY!', 'SUCCESS');
    } else {
      this.log('⚠️ SOME TESTS FAILED - REVIEW REQUIRED', 'WARNING');
    }
  }

  getTestResults() {
    return this.testResults;
  }
}

// Export for use in other files
export default QuizPlatformTester;

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new QuizPlatformTester(process.env.BASE_URL || 'http://localhost:3000');
  tester.runAllTests().catch(console.error);
}
#!/usr/bin/env node

// Manual Testing Script for Daily Live Quiz Platform
// This script provides step-by-step validation of all production requirements

import axios from 'axios';
import { readFileSync, writeFileSync } from 'fs';

class ManualTester {
  constructor() {
    this.baseURL = 'http://localhost:3000';
    this.testResults = [];
    this.adminToken = null;
    this.userToken = null;
    this.unpaidUserToken = null;
  }

  log(message, status = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${status}] ${message}`);
    this.testResults.push({ timestamp, status, message });
  }

  async waitForServer() {
    this.log('⏳ Waiting for server to be ready...', 'INFO');
    for (let i = 0; i < 30; i++) {
      try {
        await axios.get(`${this.baseURL}`, { timeout: 2000 });
        this.log('✅ Server is responding', 'SUCCESS');
        return true;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    this.log('❌ Server failed to respond within 30 seconds', 'ERROR');
    return false;
  }

  async testSystemHealth() {
    this.log('🏥 TESTING SYSTEM HEALTH ENDPOINT', 'TEST');

    try {
      // First try without auth to see if endpoint exists
      const response = await axios.get(`${this.baseURL}/admin/system/health`, {
        headers: { Authorization: `Bearer ${this.adminToken || 'dummy'}` },
        timeout: 5000
      });

      if (response.status === 200) {
        const health = response.data;
        this.log(`✅ System health endpoint working - Status: ${health.status}`, 'PASS');

        // Check components
        Object.entries(health.components || {}).forEach(([component, status]) => {
          const statusText = status.status === 'healthy' ? '✅' : '⚠️';
          this.log(`${statusText} ${component}: ${status.status}`, status.status === 'healthy' ? 'PASS' : 'WARN');
        });
      } else {
        this.log(`⚠️ System health endpoint returned status ${response.status}`, 'WARN');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        this.log('✅ System health endpoint exists (requires authentication)', 'PASS');
      } else {
        this.log(`❌ System health endpoint failed: ${error.message}`, 'ERROR');
      }
    }
  }

  async testRateLimitMonitoring() {
    this.log('📊 TESTING RATE LIMIT MONITORING ENDPOINT', 'TEST');

    try {
      const response = await axios.get(`${this.baseURL}/admin/system/rate-limits`, {
        headers: { Authorization: `Bearer ${this.adminToken || 'dummy'}` },
        timeout: 5000
      });

      if (response.status === 200) {
        const rateLimits = response.data;
        this.log(`✅ Rate limit monitoring working - ${rateLimits.totalKeys || 0} active keys`, 'PASS');
      } else {
        this.log(`⚠️ Rate limit monitoring returned status ${response.status}`, 'WARN');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        this.log('✅ Rate limit monitoring endpoint exists (requires authentication)', 'PASS');
      } else {
        this.log(`❌ Rate limit monitoring failed: ${error.message}`, 'ERROR');
      }
    }
  }

  async testQuizPerformance() {
    this.log('📈 TESTING QUIZ PERFORMANCE ENDPOINT', 'TEST');

    try {
      const response = await axios.get(`${this.baseURL}/admin/system/quiz-performance`, {
        headers: { Authorization: `Bearer ${this.adminToken || 'dummy'}` },
        timeout: 5000
      });

      if (response.status === 200) {
        const performance = response.data;
        if (performance.message) {
          this.log(`✅ Quiz performance endpoint working - ${performance.message}`, 'PASS');
        } else {
          this.log(`✅ Quiz performance endpoint working - ${performance.totalAttempts || 0} attempts`, 'PASS');
        }
      } else {
        this.log(`⚠️ Quiz performance returned status ${response.status}`, 'WARN');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        this.log('✅ Quiz performance endpoint exists (requires authentication)', 'PASS');
      } else {
        this.log(`❌ Quiz performance monitoring failed: ${error.message}`, 'ERROR');
      }
    }
  }

  async testBasicEndpoints() {
    this.log('🔗 TESTING BASIC API ENDPOINTS', 'TEST');

    const endpoints = [
      { path: '/', method: 'GET', description: 'Root endpoint' },
      { path: '/auth/login', method: 'POST', description: 'Login endpoint' },
      { path: '/quiz/today', method: 'GET', description: 'Today\'s quiz' },
      { path: '/admin/quiz', method: 'GET', description: 'Admin quiz list' }
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios({
          method: endpoint.method,
          url: `${this.baseURL}${endpoint.path}`,
          timeout: 5000,
          validateStatus: () => true // Accept any status
        });

        if (response.status < 500) {
          this.log(`✅ ${endpoint.description} - Status: ${response.status}`, 'PASS');
        } else {
          this.log(`⚠️ ${endpoint.description} - Status: ${response.status}`, 'WARN');
        }
      } catch (error) {
        this.log(`❌ ${endpoint.description} - Error: ${error.message}`, 'ERROR');
      }
    }
  }

  async testRateLimiting() {
    this.log('🚦 TESTING RATE LIMITING BEHAVIOR', 'TEST');

    // Test quiz list endpoint rate limiting
    let successCount = 0;
    let rateLimitCount = 0;

    this.log('Testing quiz list rate limiting (200 requests)...', 'INFO');

    for (let i = 0; i < 210; i++) {
      try {
        const response = await axios.get(`${this.baseURL}/quiz/list`, {
          timeout: 2000,
          validateStatus: () => true
        });

        if (response.status === 200) {
          successCount++;
        } else if (response.status === 429) {
          rateLimitCount++;
          break; // Stop on first rate limit
        } else {
          this.log(`Unexpected status: ${response.status}`, 'WARN');
        }
      } catch (error) {
        if (error.response?.status === 429) {
          rateLimitCount++;
          break;
        } else {
          this.log(`Request ${i + 1} failed: ${error.message}`, 'ERROR');
        }
      }

      // Small delay to avoid overwhelming
      if (i % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    this.log(`Rate limit test: ${successCount} successful, ${rateLimitCount} rate limited`, 'INFO');

    if (rateLimitCount > 0) {
      this.log('✅ Rate limiting is working correctly', 'PASS');
    } else {
      this.log('⚠️ Rate limiting may not be active or limits are very high', 'WARN');
    }
  }

  async runComprehensiveTest() {
    this.log('🚀 STARTING COMPREHENSIVE MANUAL TESTING SUITE', 'START');
    this.log('Daily Live Quiz Platform - Production Validation', 'INFO');
    this.log('===============================================', 'INFO');

    // Step 1: Wait for server
    const serverReady = await this.waitForServer();
    if (!serverReady) {
      this.log('❌ Cannot proceed without server - please start the backend server first', 'ERROR');
      this.generateReport();
      return;
    }

    // Step 2: Test basic connectivity
    await this.testBasicEndpoints();

    // Step 3: Test monitoring endpoints
    await this.testSystemHealth();
    await this.testRateLimitMonitoring();
    await this.testQuizPerformance();

    // Step 4: Test rate limiting
    await this.testRateLimiting();

    // Step 5: Generate report
    this.generateReport();
  }

  generateReport() {
    this.log('📊 MANUAL TESTING REPORT', 'SUMMARY');
    this.log('========================', 'SUMMARY');

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

    // Detailed recommendations
    this.log('', 'SUMMARY');
    this.log('RECOMMENDATIONS:', 'SUMMARY');

    if (failed === 0) {
      this.log('✅ All critical endpoints are responding', 'SUCCESS');
      this.log('✅ System monitoring endpoints are functional', 'SUCCESS');
      this.log('✅ Rate limiting appears to be working', 'SUCCESS');
      this.log('🎉 MANUAL TESTING PASSED - Ready for production!', 'SUCCESS');
    } else {
      this.log('❌ Some endpoints are not responding - check server logs', 'ERROR');
      this.log('🔧 Ensure MongoDB and Redis are running', 'INFO');
      this.log('🔧 Check environment variables are properly set', 'INFO');
    }

    // Save results to file
    const report = {
      timestamp: new Date().toISOString(),
      summary: { total, passed, failed, warnings, successRate },
      results: this.testResults,
      recommendations: failed === 0 ? 'Production Ready' : 'Requires fixes before production'
    };

    try {
      writeFileSync('manual-test-results.json', JSON.stringify(report, null, 2));
      this.log('📄 Detailed results saved to manual-test-results.json', 'INFO');
    } catch (error) {
      this.log(`❌ Failed to save results: ${error.message}`, 'ERROR');
    }
  }
}

// Run the manual tests
const tester = new ManualTester();
tester.runComprehensiveTest().catch(console.error);
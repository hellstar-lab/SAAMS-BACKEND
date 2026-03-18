/**
 * k6 Load Test Script for SAAM Backend
 * 
 * Install k6: https://k6.io/docs/get-started/installation/
 * Run: k6 run loadtest.js
 *
 * WHY: Validates that the backend can serve 100 concurrent users
 * with p95 response time < 2000ms and error rate < 1%.
 */

import http from 'k6/http'
import { sleep, check } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// ─── CUSTOM METRICS ───────────────────────────────────────────────────────────
const errorRate      = new Rate('error_rate')
const responseTime   = new Trend('response_time_ms', true)

// ─── TEST CONFIGURATION ───────────────────────────────────────────────────────
export const options = {
  stages: [
    // WHY: Ramp up slowly — don't slam 100 users at t=0
    { duration: '30s', target: 100 },  // Ramp from 1 → 100 VUs over 30s
    // WHY: Sustained load for 60s — the real-world scenario for a class of 50 students + teacher
    { duration: '60s', target: 100 },  // Hold 100 VUs for 60s
    // WHY: Graceful cooldown — check the server recovers cleanly
    { duration: '10s', target: 0   },  // Ramp down over 10s
  ],
  thresholds: {
    // WHY: These are the acceptance criteria from the refactoring request
    'http_req_duration': ['p(95)<2000'],  // p95 must be < 2,000 ms
    'error_rate':        ['rate<0.01'],   // Error rate must be < 1%
    'http_req_failed':   ['rate<0.01'],   // HTTP failures must be < 1%
  }
}

// WHY: Target the health endpoint — it's lightweight, stable, and doesn't need auth.
// To test authenticated endpoints, swap in a valid long-lived token below.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''   // optional: Bearer token for authenticated tests

// ─── VIRTUAL USER SCENARIO ────────────────────────────────────────────────────
export default function () {
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {})
  }

  // ── Test 1: Health endpoint (unauthenticated) ── 
  {
    const res = http.get(`${BASE_URL}/health`, { headers })
    const ok = check(res, {
      'health status 200': r => r.status === 200,
      'health returns ok':  r => {
        try { return JSON.parse(r.body).status === 'ok' } catch { return false }
      }
    })
    errorRate.add(!ok)
    responseTime.add(res.timings.duration)
    sleep(0.2)
  }

  // ── Test 2: GET /api/departments (cacheable read-only list) ────────────────
  if (AUTH_TOKEN) {
    const res = http.get(`${BASE_URL}/api/departments`, { headers })
    const ok = check(res, {
      'departments status 200': r => r.status === 200,
    })
    errorRate.add(!ok)
    responseTime.add(res.timings.duration)
    sleep(0.2)
  }

  // ── Test 3: GET /api/sessions/all-active (student endpoint) ─────────────────
  if (AUTH_TOKEN) {
    const res = http.get(`${BASE_URL}/api/sessions/all-active`, { headers })
    const ok = check(res, {
      'sessions status not 5xx': r => r.status < 500,
    })
    errorRate.add(!ok)
    responseTime.add(res.timings.duration)
    sleep(0.3)
  }

  // WHY: Short sleep between iterations — simulates real user think-time
  sleep(0.5)
}

/*
 * ─── EXPECTED OUTPUT WHEN PASSING ─────────────────────────────────────────────
 *
 *   scenarios: (100.00%) 1 scenario, 100 max VUs, 1m50s max duration
 *
 *   ✓ health status 200
 *   ✓ health returns ok
 *   ✓ departments status 200
 *   ✓ sessions status not 5xx
 *
 *   checks.........................: 100.00% ✓ 12000 ✗ 0
 *   data_received..................: 4.5 MB  56 kB/s
 *   data_sent......................: 1.2 MB  15 kB/s
 *   error_rate.....................: 0.00%   ✓ 0 ✗ 12000
 *   http_req_duration..............: avg=185ms  min=21ms   med=160ms  max=980ms  p(90)=400ms  p(95)=590ms
 *   http_req_failed................: 0.00%   ✓ 0 ✗ 12000
 *   http_reqs......................: 12000   150/s
 *   iteration_duration.............: avg=1.15s  min=720ms  med=1.08s  max=3.2s   p(90)=1.6s   p(95)=1.88s
 *   iterations.....................: 4000    50/s
 *   response_time_ms...............: avg=185ms              p(95)=590ms ← MUST be < 2000ms ✅
 *   vus............................: 100     min=0           max=100
 *   vus_max........................: 100
 *
 * ─── HOW TO RUN ───────────────────────────────────────────────────────────────
 *
 *   # Unauthenticated (health endpoint only):
 *   k6 run loadtest.js --env BASE_URL=https://your-backend.onrender.com
 *
 *   # Authenticated (all endpoints):
 *   k6 run loadtest.js \
 *     --env BASE_URL=https://your-backend.onrender.com \
 *     --env AUTH_TOKEN=<firebase-id-token>
 *
 * ─── TRADE-OFFS (Render Free Tier) ───────────────────────────────────────────
 *
 *   1. No Redis: Rate limiting uses in-memory storage. If you scale to 2+ instances
 *      (paid tier), rate limit counters will NOT be shared across instances.
 *      Upgrade to express-rate-limit + redis-store when you go multi-instance.
 *
 *   2. 20-slot concurrency cap: The global semaphore protects RAM but means requests
 *      queue under burst load. For production at 500+ users, move to a dedicated
 *      instance with more RAM and raise MAX_CONCURRENT.
 *
 *   3. LRU cache is single-process: The cache lives in Node's heap. At 100 entries
 *      of typical JSON responses (~10 KB each), that's ~1 MB — negligible.
 *      But cache WON'T be shared if you ever go multi-process.
 */

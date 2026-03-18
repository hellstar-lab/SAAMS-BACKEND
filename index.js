import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import timeout from 'connect-timeout'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'

dotenv.config()

import authRoutes from './routes/authRoutes.js'
import classRoutes from './routes/classRoutes.js'
import sessionRoutes from './routes/sessionRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'
import faceRoutes from './routes/faceRoutes.js'
import departmentRoutes from './routes/departmentRoutes.js'
import hodRoutes from './routes/hodRoutes.js'
import disputeRoutes from './routes/disputeRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import superAdminRoutes from './routes/superAdminRoutes.js'
import { initFaceApi } from './utils/faceService.js'
import { errorMiddleware } from './middleware/errorMiddleware.js'
import { concurrencyMiddleware, getConcurrencyStats } from './middleware/concurrencyMiddleware.js'
import { getCacheStats } from './middleware/cacheMiddleware.js'

const app = express()
const PORT = process.env.PORT || 3000

// ─── REQUEST ID ──────────────────────────────────────────────────────────────
// WHY: Attach a unique ID to every request for server-side log correlation
app.use((req, res, next) => {
  req.requestId = randomUUID()
  res.setHeader('X-Request-Id', req.requestId)
  next()
})

// ─── GLOBAL TIMEOUT ──────────────────────────────────────────────────────────
// WHY: Abort any request that takes > 15s to prevent hung connections blocking the event loop
app.use(timeout('15s'))
app.use((req, res, next) => {
  if (req.timedout) return  // WHY: Stop processing if timeout already fired
  next()
})

// ─── SECURITY ─────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }  // WHY: Allow mobile apps to upload images
}))

// ─── CONCURRENCY LIMITER ──────────────────────────────────────────────────────
// WHY: Caps simultaneous requests at 20 to protect 512 MB RAM on Render Free Tier
app.use(concurrencyMiddleware)

// ─── RATE LIMITING ───────────────────────────────────────────────────────────

// General endpoints — 60 requests/minute per IP
// WHY: Prevents DDoS and bad actors from exhausting server capacity
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = Math.ceil(req.rateLimit.resetTime / 1000 - Date.now() / 1000)
    res.setHeader('Retry-After', retryAfter)
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please slow down.',
      retry_after: retryAfter
    })
  }
})

// Auth endpoints — 10 requests/minute per IP
// WHY: Brute-force protection for login/register with a tighter sliding window
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.setHeader('Retry-After', 60)
    res.status(429).json({
      success: false,
      error: 'Too many auth attempts. Please wait 1 minute.',
      retry_after: 60
    })
  }
})

// ─── BODY PARSING ─────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }))
// WHY: 50 MB limit allows raw base64 camera images from React Native
app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))

// ─── HEALTH ENDPOINT ─────────────────────────────────────────────────────────
// WHY: Render pings this endpoint to detect crashes — includes memory, uptime,
// and concurrency diagnostics for operational visibility
app.get('/health', (req, res) => {
  const memMb = process.memoryUsage().rss / 1024 / 1024
  const concurrency = getConcurrencyStats()
  const cacheStats = getCacheStats()

  // WHY: Warn if memory usage exceeds 80% of the 512 MB free-tier limit (~409 MB)
  if (memMb > 409) {
    console.warn(`⚠️  HIGH MEMORY USAGE: ${memMb.toFixed(1)} MB RSS — approaching 512 MB limit`)
  }

  res.status(200).json({
    success: true,
    status: 'ok',
    app: 'SAAM Backend',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    memory_mb: Math.round(memMb),
    concurrency,
    cache: cacheStats,
    timestamp: new Date().toISOString()
  })
})

// ─── ROUTES ──────────────────────────────────────────────────────────────────
// WHY: Auth routes get the tighter 10/min rate limit
app.use('/api/auth', authLimiter, authRoutes)

// WHY: All other routes get general 60/min rate limit
app.use('/api/classes',       generalLimiter, classRoutes)
app.use('/api/sessions',      generalLimiter, sessionRoutes)
app.use('/api/attendance',    generalLimiter, attendanceRoutes)
app.use('/api/face',          generalLimiter, faceRoutes)
app.use('/api/departments',   generalLimiter, departmentRoutes)
app.use('/api/hod',           generalLimiter, hodRoutes)
app.use('/api/disputes',      generalLimiter, disputeRoutes)
app.use('/api/notifications', generalLimiter, notificationRoutes)
app.use('/api/admin',         generalLimiter, superAdminRoutes)

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  })
})

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────────────────────
// WHY: Catches all unhandled errors from any route and formats them safely for clients
app.use(errorMiddleware)

// ─── FACE-API PRELOAD ────────────────────────────────────────────────────────
// WHY: Pre-warm face model loading at startup so first student registration is not slow
initFaceApi().catch(err => {
  console.warn('⚠️  face-api models could not be pre-loaded:', err.message)
})

// ─── SERVER WITH KEEP-ALIVE ──────────────────────────────────────────────────
// WHY: keepAliveTimeout = 65s is slightly above Render's 60s load balancer timeout
// This prevents 502 errors from the ALB closing connections before the server
const server = app.listen(PORT, () => {
  console.log(`SAAM Backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})
server.keepAliveTimeout = 65 * 1000   // WHY: Beats Render ALB 60s timeout
server.headersTimeout   = 66 * 1000   // WHY: Must be slightly above keepAliveTimeout

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
// WHY: Render sends SIGTERM before killing the container during deploys.
// This ensures in-flight requests finish before the process exits, preventing 502s.
let isShuttingDown = false
function gracefulShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n🛑 Received ${signal}. Graceful shutdown initiated...`)

  // WHY: Stop accepting new connections immediately
  server.close(() => {
    console.log('✅ All connections closed. Exiting.')
    process.exit(0)
  })

  // WHY: Force-exit after 10s if in-flight requests are still hung
  setTimeout(() => {
    console.error('❌ Forced exit — graceful shutdown timed out.')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT',  () => gracefulShutdown('SIGINT'))

// ─── UNHANDLED REJECTIONS ─────────────────────────────────────────────────────
// WHY: Catch any Promise rejection that no route handler caught — log but do NOT crash
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
  // WHY: uncaughtException usually means corrupted state — exit after logging so Render restarts
  gracefulShutdown('uncaughtException')
})

export default app

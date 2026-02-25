import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
dotenv.config()

import authRoutes from './routes/authRoutes.js'
import classRoutes from './routes/classRoutes.js'
import sessionRoutes from './routes/sessionRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'
import faceRoutes from './routes/faceRoutes.js'
import { initFaceApi } from './utils/faceService.js'
import { errorMiddleware } from './middleware/errorMiddleware.js'

const app = express()
const PORT = process.env.PORT || 3000

// Security
app.use(helmet())

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: 'Too many requests'
  }
})
app.use(limiter)

// Middleware
app.use(cors({ origin: '*' }))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    app: 'SAAM Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  })
})

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/classes', classRoutes)
app.use('/api/sessions', sessionRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/face', faceRoutes)

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  })
})

// Error handler
app.use(errorMiddleware)

// Pre-load face-api models — non-fatal if something is wrong, endpoints will return error
initFaceApi().catch(err => {
  console.warn('⚠️  face-api models could not be pre-loaded:', err.message)
  console.warn('    Face endpoints will attempt to load models on first request.')
})

app.listen(PORT, () => {
  console.log(`SAAM Backend running on port ${PORT}`)
})

export default app

import express from 'express'
import { verifyToken, authorize } from '../middleware/authMiddleware.js'
import {
    startSession,
    endSession,
    getActiveSession,
    getSessionById,
    getClassSessions,
    updateQRCode,
    getSessionStats,
    refreshQrCode,
    getMySessionHistory,
    getAllActiveSessions
} from '../controllers/sessionController.js'

const router = express.Router()

// All session routes require authentication
router.use(verifyToken)

// ─── Static/keyword routes FIRST (before :sessionId param routes) ──────────────
router.post('/start', authorize(['teacher', 'hod', 'superAdmin']), startSession)
router.get('/my-sessions', authorize(['teacher', 'hod']), getMySessionHistory)
router.get('/all-active', authorize(['student', 'teacher', 'hod', 'superAdmin']), getAllActiveSessions)
router.get('/active/:classId', authorize(['teacher', 'hod', 'student', 'superAdmin']), getActiveSession)
router.get('/class/:classId', authorize(['teacher', 'hod', 'superAdmin']), getClassSessions)

// ─── Parameterized routes ──────────────────────────────────────────────────────
router.post('/:sessionId/end', authorize(['teacher', 'hod', 'superAdmin']), endSession)
router.get('/:sessionId', authorize(['teacher', 'hod', 'student', 'superAdmin']), getSessionById)
router.put('/:sessionId/qr', authorize(['teacher', 'hod']), updateQRCode)
router.patch('/:sessionId/refresh-qr', authorize(['teacher', 'hod']), refreshQrCode)
router.get('/:sessionId/stats', authorize(['teacher', 'hod', 'superAdmin']), getSessionStats)


export default router

import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import {
    startSession,
    endSession,
    getActiveSession,
    getSessionById,
    getClassSessions,
    updateQRCode,
    getSessionStats
} from '../controllers/sessionController.js'

const router = express.Router()

// All session routes require authentication
router.use(verifyToken)

router.post('/start', startSession)
router.post('/:sessionId/end', endSession)
router.get('/active/:classId', getActiveSession)
router.get('/class/:classId', getClassSessions)
router.get('/:sessionId', getSessionById)
router.put('/:sessionId/qr', updateQRCode)
router.get('/:sessionId/stats', getSessionStats)

export default router

import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import {
    markAttendance,
    manualApprove,
    getSessionAttendance,
    getStudentAttendance,
    updateAttendanceStatus,
    getAttendanceReport,
    exportAttendanceReport
} from '../controllers/attendanceController.js'

const router = express.Router()

// All attendance routes require authentication
router.use(verifyToken)

router.post('/mark', markAttendance)
router.post('/manual-approve', manualApprove)
router.get('/session/:sessionId', getSessionAttendance)
router.get('/student/:studentId', getStudentAttendance)
router.get('/report/:classId', getAttendanceReport)
router.get('/export/:classId', exportAttendanceReport)
router.put('/:attendanceId/status', updateAttendanceStatus)

export default router

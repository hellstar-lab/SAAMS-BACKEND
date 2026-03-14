import express from 'express'
import { verifyToken, authorize } from '../middleware/authMiddleware.js'
import rateLimit from 'express-rate-limit'

const exportLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per user as required by spec
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many export requests. Please try again later.', code: 'RATE_LIMIT_EXCEEDED' },
    keyGenerator: (req) => req.user?.uid || req.ip
})
import {
    markAttendance,
    manualApprove,
    getSessionAttendance,
    getStudentAttendance,
    updateAttendanceStatus,
    getAttendanceReport,
    exportClassExcel,
    exportClassPdf,
    exportStudentCertificate,
    exportDepartmentExcel,
    approveLateAttendance,
    autoAbsentLateStudents,
    endSessionAndMarkAbsent,
    exportSessionExcel,
    exportSessionPdf
} from '../controllers/attendanceController.js'

const router = express.Router()

// All attendance routes require authentication
router.use(verifyToken)

router.post('/mark', authorize(['teacher', 'hod', 'student', 'superAdmin']), markAttendance)
router.post('/manual-approve', authorize(['teacher', 'hod', 'superAdmin']), manualApprove)
router.get('/student/:studentId', authorize(['teacher', 'hod', 'student', 'superAdmin']), getStudentAttendance)
router.get('/report/:classId', authorize(['teacher', 'hod', 'superAdmin']), getAttendanceReport)

router.get('/certificate/:studentId', authorize(['teacher', 'hod', 'student', 'superAdmin']), exportStudentCertificate)
router.get('/export/department/:departmentId', authorize(['hod', 'superAdmin']), exportDepartmentExcel)
router.put('/:attendanceId/status', authorize(['teacher', 'hod', 'superAdmin']), updateAttendanceStatus)

router.patch('/:attendanceId/approve', authorize(['teacher', 'hod', 'superAdmin']), approveLateAttendance)
router.post('/auto-absent/:sessionId', authorize(['teacher', 'hod', 'superAdmin']), autoAbsentLateStudents)
router.post('/end-session', authorize(['teacher', 'hod', 'superAdmin']), endSessionAndMarkAbsent)

// NEW ROUTES (Re-mapping for God-Mode compliance)
router.get('/session/:sessionId', authorize(['teacher', 'hod', 'superAdmin']), getSessionAttendance)
router.get('/export/class/:classId', authorize(['teacher', 'hod', 'superAdmin']), exportLimiter, exportSessionExcel)
router.get('/export/class/:classId/pdf', authorize(['teacher', 'hod', 'superAdmin']), exportLimiter, exportSessionPdf)

export default router

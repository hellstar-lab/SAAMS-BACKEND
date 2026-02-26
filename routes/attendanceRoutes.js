import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import {
    markAttendance,
    manualApprove,
    getSessionAttendance,
    getStudentAttendance,
    updateAttendanceStatus,
    getAttendanceReport,
    exportAttendanceExcel,
    exportAttendancePDF,
    exportStudentCertificate,
    exportDepartmentExcel,
    approveLateAttendance,
    autoAbsentLateStudents,
    endSessionAndMarkAbsent
} from '../controllers/attendanceController.js'

const router = express.Router()

// All attendance routes require authentication
router.use(verifyToken)

router.post('/mark', markAttendance)
router.post('/manual-approve', manualApprove)
router.get('/session/:sessionId', getSessionAttendance)
router.get('/student/:studentId', getStudentAttendance)
router.get('/report/:classId', getAttendanceReport)
router.get('/export/class/:classId', exportAttendanceExcel)
router.get('/export/class/:classId/pdf', exportAttendancePDF)
router.get('/certificate/:studentId', exportStudentCertificate)
router.get('/export/department/:departmentId', exportDepartmentExcel)
router.put('/:attendanceId/status', updateAttendanceStatus)

router.patch('/:attendanceId/approve', approveLateAttendance)
router.post('/auto-absent/:sessionId', autoAbsentLateStudents)
router.post('/end-session', endSessionAndMarkAbsent)

export default router

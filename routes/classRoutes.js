import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import {
    createClass,
    getMyClasses,
    getClassById,
    addStudentsToClass,
    removeStudentFromClass,
    archiveClass,
    getClassStudents,
    getStudentClasses
} from '../controllers/classController.js'

const router = express.Router()

// All class routes require authentication
router.use(verifyToken)

// ─── Static routes MUST come before /:classId ──────────────────────────────────
router.post('/', createClass)
router.get('/my-classes', getStudentClasses)       // BEFORE /:classId
router.get('/', getMyClasses)

// ─── Parameterized routes ──────────────────────────────────────────────────────
router.get('/:classId', getClassById)
router.post('/:classId/students', addStudentsToClass)
router.delete('/:classId/students/:studentId', removeStudentFromClass)
router.patch('/:classId/archive', archiveClass)
router.get('/:classId/students', getClassStudents)

export default router

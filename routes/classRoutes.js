import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import {
    createClass,
    getTeacherClasses,
    getClassById,
    updateClass,
    deleteClass,
    addStudent,
    removeStudent,
    importStudents,
    getClassStudents
} from '../controllers/classController.js'

const router = express.Router()

// All class routes require authentication
router.use(verifyToken)

router.post('/', createClass)
router.get('/teacher', getTeacherClasses)
router.get('/:classId', getClassById)
router.put('/:classId', updateClass)
router.delete('/:classId', deleteClass)
router.post('/:classId/students/add', addStudent)
router.post('/:classId/students/remove', removeStudent)
router.post('/:classId/students/import', importStudents)
router.get('/:classId/students', getClassStudents)

export default router

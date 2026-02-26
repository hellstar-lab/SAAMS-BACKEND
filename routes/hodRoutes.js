import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
    getDepartmentOverview, getDepartmentTeachers, addTeacherToDepartment,
    removeTeacherFromDepartment, getDepartmentStudents, addStudentToDepartment,
    removeStudentFromDepartment, getDepartmentAttendance, getDepartmentSessions,
    getDepartmentFraudFlags, reviewFraudFlagByHod
} from '../controllers/hodController.js';

const router = express.Router();
router.use(verifyToken);

// ─── OVERVIEW ───
router.get('/overview', getDepartmentOverview);

// ─── TEACHERS ───
router.get('/teachers', getDepartmentTeachers);
router.post('/teachers', addTeacherToDepartment);
router.delete('/teachers/:teacherId', removeTeacherFromDepartment);

// ─── STUDENTS ───
router.get('/students', getDepartmentStudents);
router.post('/students', addStudentToDepartment);
router.delete('/students/:studentId', removeStudentFromDepartment);

// ─── ATTENDANCE & SESSIONS ───
router.get('/attendance', getDepartmentAttendance);
router.get('/sessions', getDepartmentSessions);

// ─── FRAUD FLAGS ───
router.get('/fraud-flags', getDepartmentFraudFlags);
router.patch('/fraud-flags/:flagId/review', reviewFraudFlagByHod);

export default router;

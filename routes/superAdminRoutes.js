import express from 'express';
import * as superAdminController from '../controllers/superAdminController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes use verifyToken middleware.
router.use(verifyToken);

// ━━━ getSystemOverview ━━━
// GET /api/admin/overview
// main dashboard — all system counts
router.get('/overview', superAdminController.getSystemOverview);

// ━━━ getAllDepartmentsDetailed ━━━
// GET /api/admin/departments
// all departments with attendance stats
router.get('/departments', superAdminController.getAllDepartmentsDetailed);

// ━━━ getAllTeachers ━━━
// GET /api/admin/teachers
// all teachers with filters
router.get('/teachers', superAdminController.getAllTeachers);

// ━━━ getAllStudents ━━━
// GET /api/admin/students
// all students with filters
router.get('/students', superAdminController.getAllStudents);

// ━━━ getActiveSessions ━━━
// GET /api/admin/sessions/active
// live sessions across university
// IMPORTANT: defined BEFORE /:param routes
router.get('/sessions/active', superAdminController.getActiveSessions);

// ━━━ getSystemFraudOverview ━━━
// GET /api/admin/fraud-overview
// fraud and suspicious activity
router.get('/fraud-overview', superAdminController.getSystemFraudOverview);

// ━━━ getAuditLogs ━━━
// GET /api/admin/audit-logs
// immutable audit trail
router.get('/audit-logs', superAdminController.getAuditLogs);

// ━━━ getSystemStats ━━━
// GET /api/admin/stats
// attendance stats by department
// IMPORTANT: defined BEFORE /:param routes
router.get('/stats', superAdminController.getSystemStats);

// ━━━ getPendingActions ━━━
// GET /api/admin/pending-actions
// everything needing attention now
// IMPORTANT: defined BEFORE /:param routes
router.get('/pending-actions', superAdminController.getPendingActions);

// ━━━ getUserDetails ━━━
// GET /api/admin/users/:uid
// any user full profile lookup
router.get('/users/:uid', superAdminController.getUserDetails);

export default router;

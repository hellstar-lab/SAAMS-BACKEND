// DISPUTE ROUTES
// NOTE: Specific named routes (/my-disputes,
// /teacher-disputes etc) MUST come before
// the /:disputeId param route to avoid
// Express routing conflicts.

import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
    raiseDispute, getStudentDisputes, getTeacherDisputes,
    getDisputeById, resolveDispute, getHodDisputes, getDisputeStats
} from '../controllers/disputeController.js';

const router = express.Router();
router.use(verifyToken);

// Student raises a new dispute against wrong attendance
router.post('/', raiseDispute);

// Student views their own dispute history
router.get('/my-disputes', getStudentDisputes);

// Teacher views disputes pending their review
router.get('/teacher-disputes', getTeacherDisputes);

// HOD or superAdmin views all disputes in department
router.get('/department-disputes', getHodDisputes);

// Any authorized user views dispute badge counts
router.get('/stats', getDisputeStats);

// Any authorized user views single dispute full detail
router.get('/:disputeId', getDisputeById);

// Teacher resolves a dispute with decision + comment
router.patch('/:disputeId/resolve', resolveDispute);

export default router;

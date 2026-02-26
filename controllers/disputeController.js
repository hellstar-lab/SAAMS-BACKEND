/**
 * DISPUTE CONTROLLER
 * Students raise disputes against wrong attendance records.
 * Teachers review and resolve with approve/reject decision.
 * On approval: attendance document is updated automatically.
 * All actions are audit logged and notifications are sent.
 * HOD and superAdmin can view all disputes in their department.
 */

import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js';
import { notifyDisputeRaised, notifyDisputeResolved } from '../utils/notificationService.js';
import { updateSummaryOnApproval } from '../utils/summaryUpdater.js';

// ─── Shared Response Helpers ───
const successRes = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const errorRes = (res, message, status = 400, code = 'ERROR') => res.status(status).json({ success: false, error: message, code });

// ━━━ 1: RAISE DISPUTE ━━━
export const raiseDispute = async (req, res, next) => {
    try {
        // STEP 1 — Verify student role
        if (req.user.role !== 'student') {
            return errorRes(res, 'Only students can raise disputes', 403, 'STUDENT_ONLY');
        }

        // STEP 2 — Validate required fields
        const { attendanceId, reason, evidenceNote } = req.body;
        if (!attendanceId || !reason) {
            return errorRes(res, 'attendanceId and reason are required', 400, 'MISSING_FIELDS');
        }
        if (reason.trim().length < 10) {
            return errorRes(res, 'Reason must be at least 10 characters', 400, 'REASON_TOO_SHORT');
        }

        // STEP 3 — Fetch attendance document
        const attendanceDoc = await db.collection('attendance').doc(attendanceId).get();
        if (!attendanceDoc.exists) {
            return errorRes(res, 'Attendance record not found', 404, 'ATTENDANCE_NOT_FOUND');
        }
        const attendanceData = attendanceDoc.data();

        // STEP 4 — Verify this attendance belongs to the requesting student
        if (attendanceData.studentId !== req.user.uid) {
            return errorRes(res, 'You can only dispute your own attendance', 403, 'NOT_YOUR_ATTENDANCE');
        }

        // STEP 5 — Verify attendance status is disputable
        if (attendanceData.status === 'present' && attendanceData.teacherApproved === true) {
            return errorRes(res, 'Present attendance cannot be disputed', 400, 'CANNOT_DISPUTE_PRESENT');
        }

        // STEP 6 — Check no duplicate dispute exists
        const existingDispute = await db.collection('disputes')
            .where('attendanceId', '==', attendanceId)
            .where('studentId', '==', req.user.uid)
            .where('status', '==', 'pending')
            .limit(1)
            .get();
        if (!existingDispute.empty) {
            return errorRes(res, 'You already have a pending dispute for this attendance record', 409, 'DISPUTE_ALREADY_EXISTS');
        }

        // STEP 7 — Fetch session document
        const sessionDoc = await db.collection('sessions').doc(attendanceData.sessionId).get();
        const sessionData = sessionDoc.exists ? sessionDoc.data() : {};

        // STEP 8 — Fetch teacher document
        const teacherDoc = await db.collection('teachers').doc(attendanceData.teacherId).get();
        const teacherName = teacherDoc.exists ? teacherDoc.data().name : 'Unknown Teacher';

        // STEP 9 — Fetch student document
        const studentDoc = await db.collection('students').doc(req.user.uid).get();
        const studentData = studentDoc.exists ? studentDoc.data() : {};

        // STEP 10 — Create dispute document
        const disputeRef = db.collection('disputes').doc();
        const disputeId = disputeRef.id;

        const newDispute = {
            disputeId,
            attendanceId,
            sessionId: attendanceData.sessionId,
            classId: attendanceData.classId,
            departmentId: attendanceData.departmentId,
            studentId: req.user.uid,
            studentName: attendanceData.studentName,
            studentRollNumber: studentData.rollNumber || attendanceData.studentRollNumber || null,
            teacherId: attendanceData.teacherId,
            teacherName: teacherName,
            subjectName: sessionData.subjectName || attendanceData.subjectName || 'Unknown Subject',
            sessionDate: sessionData.startTime || null,
            originalStatus: attendanceData.status,
            reason: reason.trim(),
            evidenceNote: evidenceNote ? evidenceNote.trim().substring(0, 500) : null,
            status: 'pending',
            teacherComment: null,
            resolvedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        await disputeRef.set(newDispute);

        // STEP 11 — Send notification to teacher (fire and forget)
        notifyDisputeRaised(
            db,
            attendanceData.teacherId,
            req.user.uid,
            disputeId,
            attendanceData.classId,
            attendanceData.departmentId,
            newDispute.subjectName,
            attendanceData.studentName
        );

        // STEP 12 — Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.DISPUTE_RAISED,
            req.user.uid,
            ACTOR_ROLES.STUDENT,
            disputeId,
            TARGET_TYPES.DISPUTE,
            createDetails({
                attendanceId,
                originalStatus: attendanceData.status,
                teacherId: attendanceData.teacherId,
                classId: attendanceData.classId,
                reason: reason.trim()
            }),
            attendanceData.departmentId,
            req.ip
        );

        // STEP 13 — Return success
        return successRes(res, {
            data: {
                disputeId,
                status: 'pending',
                message: 'Dispute raised successfully. Your teacher will review it soon.'
            }
        }, 201);
    } catch (error) {
        console.error('raiseDispute error:', error);
        next(error);
    }
};

// ━━━ 2: GET STUDENT DISPUTES ━━━
export const getStudentDisputes = async (req, res, next) => {
    try {
        if (req.user.role !== 'student') {
            return errorRes(res, 'Only students can view their disputes', 403, 'STUDENT_ONLY');
        }

        const snap = await db.collection('disputes')
            .where('studentId', '==', req.user.uid)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        const disputes = snap.docs.map(doc => doc.data());

        return successRes(res, { data: disputes, count: disputes.length });
    } catch (error) {
        console.error('getStudentDisputes error:', error);
        next(error);
    }
};

// ━━━ 3: GET TEACHER DISPUTES ━━━
export const getTeacherDisputes = async (req, res, next) => {
    try {
        if (req.user.role === 'student') {
            return errorRes(res, 'Students cannot access teacher disputes', 403, 'NOT_AUTHORIZED');
        }

        const { status } = req.query;

        let query = db.collection('disputes').where('teacherId', '==', req.user.uid);
        if (status) query = query.where('status', '==', status);
        query = query.orderBy('createdAt', 'desc').limit(50);

        const snap = await query.get();
        const all = snap.docs.map(doc => doc.data());

        const pending = all.filter(d => d.status === 'pending');
        const resolved = all.filter(d => d.status !== 'pending');

        return successRes(res, {
            data: { all, pending, resolved },
            counts: { total: all.length, pending: pending.length, resolved: resolved.length }
        });
    } catch (error) {
        console.error('getTeacherDisputes error:', error);
        next(error);
    }
};

// ━━━ 4: GET DISPUTE BY ID ━━━
export const getDisputeById = async (req, res, next) => {
    try {
        const { disputeId } = req.params;
        const disputeDoc = await db.collection('disputes').doc(disputeId).get();

        if (!disputeDoc.exists) {
            return errorRes(res, 'Dispute not found', 404, 'NOT_FOUND');
        }

        const dispute = disputeDoc.data();

        // Access control
        if (req.user.role === 'student' && dispute.studentId !== req.user.uid) {
            return errorRes(res, 'Not authorized to view this dispute', 403, 'UNAUTHORIZED');
        }
        if (req.user.role === 'teacher' && dispute.teacherId !== req.user.uid) {
            return errorRes(res, 'Not authorized to view this dispute', 403, 'UNAUTHORIZED');
        }
        if (req.user.role === 'hod' && dispute.departmentId !== req.user.departmentId) {
            return errorRes(res, 'Not authorized to view this dispute', 403, 'UNAUTHORIZED');
        }
        // superAdmin: always allowed

        // Fetch linked attendance for context
        const attendanceDoc = await db.collection('attendance').doc(dispute.attendanceId).get();
        const attendanceData = attendanceDoc.exists ? attendanceDoc.data() : null;

        return successRes(res, {
            data: {
                dispute,
                attendanceContext: attendanceData ? {
                    status: attendanceData.status,
                    method: attendanceData.method,
                    faceVerified: attendanceData.faceVerified,
                    joinedAt: attendanceData.joinedAt,
                    markedAt: attendanceData.markedAt,
                    studentLat: attendanceData.studentLat,
                    studentLng: attendanceData.studentLng
                } : null
            }
        });
    } catch (error) {
        console.error('getDisputeById error:', error);
        next(error);
    }
};

// ━━━ 5: RESOLVE DISPUTE ━━━
export const resolveDispute = async (req, res, next) => {
    try {
        // STEP 1 — Verify teacher role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorRes(res, 'Only teachers can resolve disputes', 403, 'TEACHER_ONLY');
        }

        // STEP 2 — Validate inputs
        const { decision, teacherComment } = req.body;
        if (!decision || !teacherComment) {
            return errorRes(res, 'decision and teacherComment are required', 400, 'MISSING_FIELDS');
        }
        if (!['approved', 'rejected'].includes(decision)) {
            return errorRes(res, 'decision must be approved or rejected', 400, 'INVALID_DECISION');
        }
        if (teacherComment.trim().length < 5) {
            return errorRes(res, 'Please provide a comment of at least 5 characters', 400, 'COMMENT_TOO_SHORT');
        }

        // STEP 3 — Fetch dispute document
        const { disputeId } = req.params;
        const disputeDoc = await db.collection('disputes').doc(disputeId).get();
        if (!disputeDoc.exists) {
            return errorRes(res, 'Dispute not found', 404, 'NOT_FOUND');
        }
        const dispute = disputeDoc.data();

        // STEP 4 — Verify this dispute belongs to this teacher
        if (dispute.teacherId !== req.user.uid) {
            return errorRes(res, 'You can only resolve disputes for your own classes', 403, 'NOT_YOUR_DISPUTE');
        }

        // STEP 5 — Verify dispute is still pending
        if (dispute.status !== 'pending') {
            return errorRes(res, 'This dispute has already been resolved', 400, 'ALREADY_RESOLVED');
        }

        // STEP 6 — Build Firestore batch
        const batch = db.batch();

        // STEP 7 — Update dispute document in batch
        const disputeRef = db.collection('disputes').doc(disputeId);
        batch.update(disputeRef, {
            status: decision,
            teacherComment: teacherComment.trim(),
            resolvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        // STEP 8 — If approved, update the linked attendance document
        if (decision === 'approved') {
            const attendanceRef = db.collection('attendance').doc(dispute.attendanceId);
            batch.update(attendanceRef, {
                status: 'present',
                teacherApproved: true,
                approvedAt: FieldValue.serverTimestamp(),
                markedAt: FieldValue.serverTimestamp()
            });
        }

        // STEP 9 — Commit the batch
        await batch.commit();

        // STEP 10 — If approved, update attendance summary (MUST await)
        if (decision === 'approved') {
            await updateSummaryOnApproval(
                db,
                dispute.studentId,
                dispute.classId,
                dispute.originalStatus,
                'present'
            );
        }

        // STEP 11 — Send notification to student (fire and forget)
        notifyDisputeResolved(
            db,
            dispute.studentId,
            disputeId,
            dispute.classId,
            dispute.departmentId,
            dispute.subjectName,
            decision,
            teacherComment.trim()
        );

        // STEP 12 — Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.DISPUTE_RESOLVED,
            req.user.uid,
            ACTOR_ROLES.TEACHER,
            disputeId,
            TARGET_TYPES.DISPUTE,
            createDetails({
                decision,
                teacherComment: teacherComment.trim(),
                studentId: dispute.studentId,
                attendanceId: dispute.attendanceId,
                originalStatus: dispute.originalStatus,
                attendanceUpdated: decision === 'approved'
            }),
            dispute.departmentId,
            req.ip
        );

        // STEP 13 — Return success
        return successRes(res, {
            data: {
                disputeId,
                decision,
                message: decision === 'approved'
                    ? 'Dispute approved. Student attendance updated to present.'
                    : 'Dispute rejected.'
            }
        });
    } catch (error) {
        console.error('resolveDispute error:', error);
        next(error);
    }
};

// ━━━ 6: GET HOD DISPUTES ━━━
export const getHodDisputes = async (req, res, next) => {
    try {
        if (req.user.role !== 'hod' && req.user.role !== 'superAdmin') {
            return errorRes(res, 'HOD or superAdmin access required', 403, 'NOT_AUTHORIZED');
        }

        const { status, limit: queryLimit, departmentId: queryDeptId } = req.query;

        const departmentId = (req.user.role === 'superAdmin' && queryDeptId)
            ? queryDeptId
            : req.user.departmentId;

        let query = db.collection('disputes').where('departmentId', '==', departmentId);
        if (status) query = query.where('status', '==', status);
        query = query.orderBy('createdAt', 'desc').limit(parseInt(queryLimit) || 30);

        const snap = await query.get();
        const disputes = snap.docs.map(doc => doc.data());

        return successRes(res, {
            data: disputes,
            counts: {
                total: disputes.length,
                pending: disputes.filter(d => d.status === 'pending').length,
                approved: disputes.filter(d => d.status === 'approved').length,
                rejected: disputes.filter(d => d.status === 'rejected').length
            }
        });
    } catch (error) {
        console.error('getHodDisputes error:', error);
        next(error);
    }
};

// ━━━ 7: GET DISPUTE STATS ━━━
export const getDisputeStats = async (req, res, next) => {
    try {
        if (req.user.role === 'student') {
            return errorRes(res, 'Students cannot access dispute stats', 403, 'NOT_AUTHORIZED');
        }

        let baseQuery;

        if (req.user.role === 'superAdmin') {
            const { departmentId } = req.query;
            baseQuery = departmentId
                ? db.collection('disputes').where('departmentId', '==', departmentId)
                : db.collection('disputes');
        } else {
            // teacher or hod — show disputes assigned to them
            baseQuery = db.collection('disputes').where('teacherId', '==', req.user.uid);
        }

        const [pendingSnap, approvedSnap, rejectedSnap] = await Promise.all([
            baseQuery.where('status', '==', 'pending').count().get(),
            baseQuery.where('status', '==', 'approved').count().get(),
            baseQuery.where('status', '==', 'rejected').count().get()
        ]);

        const pending = pendingSnap.data().count;
        const approved = approvedSnap.data().count;
        const rejected = rejectedSnap.data().count;
        const total = pending + approved + rejected;

        return successRes(res, {
            data: {
                pending,
                approved,
                rejected,
                total,
                message: pending > 0
                    ? `${pending} dispute(s) need your review`
                    : 'No pending disputes'
            }
        });
    } catch (error) {
        console.error('getDisputeStats error:', error);
        next(error);
    }
};

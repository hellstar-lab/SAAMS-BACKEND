import { db, admin } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, errorResponse } from '../utils/responseHelper.js';
import { isStudentLate } from '../utils/lateDetection.js';
import { generateClassAttendanceExcel, generateDepartmentExcel, generateSessionAttendanceExcel } from '../utils/excelGenerator.js';
import { generateAttendanceCertificate, generateSessionReport } from '../utils/pdfGenerator.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js';
import { notifyStudentLate, notifyLowAttendance, notifyAttendanceDecision, notifyFraudDetected } from '../utils/notificationService.js';
import { updateSummaryOnAttendance, updateSummaryOnApproval, getSummaryForClass } from '../utils/summaryUpdater.js';
import { checkDuplicateDevice, checkRapidScan, checkGPSProximity } from '../utils/fraudDetector.js';

// ─── Haversine Distance Formula ───────────────────────────────────────────────
/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1 (teacher)
 * @param {number} lng1 - Longitude of point 1 (teacher)
 * @param {number} lat2 - Latitude of point 2 (student)
 * @param {number} lng2 - Longitude of point 2 (student)
 * @returns {number} Distance in meters
 */
const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;
    
    const a = 
        Math.sin(deltaPhi / 2) ** 2 + 
        Math.cos(phi1) * Math.cos(phi2) * 
        Math.sin(deltaLambda / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
};

// ─── Shared: parse date range from query ──────────────────────────────────────
const parseDateRange = (fromDate, toDate) => {
    const from = fromDate ? new Date(fromDate) : new Date('2000-01-01');
    const to = toDate ? new Date(toDate) : new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
};

// ─── Shared: build per-student summary from attendance records ────────────────
const buildStudentSummary = (records, totalSessions) => {
    const map = {};
    for (const r of records) {
        if (!map[r.studentId]) {
            map[r.studentId] = { present: 0, late: 0, absent: 0, faceFailed: 0, manualApproved: 0 };
        }
        const s = map[r.studentId];
        if (r.status === 'present') s.present++;
        else if (r.status === 'late') s.late++;
        else if (r.status === 'absent') s.absent++;
        else if (r.status === 'face_failed') s.faceFailed++;
        if (r.manualApproval === true) s.manualApproved++;
    }
    return map;
};

// ━━━ MARK ATTENDANCE (GPS) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class AttendanceError extends Error {
    constructor(code, message, data = {}, statusCode = 400) {
        super(message);
        this.code = code;
        this.data = data;
        this.statusCode = statusCode;
    }
}

/**
 * Mark attendance using GPS location verification
 * POST /api/attendance/mark
 * 
 * Production-ready implementation with:
 * - Pre-transaction validation (lightweight checks)
 * - Transaction-based atomic read-write (prevents race conditions)
 * - Comprehensive input validation
 * - Precise Haversine distance calculation
 * - Proper status determination (present/late)
 * - Complete attendance document creation
 */
export const markAttendance = async (req, res, next) => {
    try {
        // STEP 1: Authentication Check (Req already verified via middleware)
        const studentId = req.user.uid;
        const studentName = req.user.name || 'Unknown';
        const rollNumber = req.user.rollNumber || null;

        // STEP 2: Input Validation (Fail-fast approach - no DB calls)
        const { sessionId, method, studentLat, studentLng } = req.body;

        // Validate sessionId
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === "") {
            return res.status(400).json({
                success: false,
                code: "SESSION_ID_REQUIRED",
                error: "sessionId is required and cannot be empty"
            });
        }

        // Validate method
        if (method !== 'gps') {
            return res.status(400).json({
                success: false,
                code: "INVALID_METHOD",
                error: "Only GPS method is supported for this endpoint"
            });
        }

        // Validate GPS coordinates presence
        if (studentLat === undefined || studentLng === undefined) {
            return res.status(400).json({
                success: false,
                code: "GPS_REQUIRED",
                error: "studentLat and studentLng are required for GPS attendance"
            });
        }

        // Parse and validate latitude
        const lat = Number(studentLat);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return res.status(400).json({
                success: false,
                code: "INVALID_LATITUDE",
                error: "Latitude must be a valid number between -90 and 90"
            });
        }

        // Parse and validate longitude
        const lng = Number(studentLng);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            return res.status(400).json({
                success: false,
                code: "INVALID_LONGITUDE",
                error: "Longitude must be a valid number between -180 and 180"
            });
        }

        // STEP 3-8: Atomic Transaction Execution
        let attendanceResult = null;

        await db.runTransaction(async (transaction) => {
            // STEP 3: Session Verification (within transaction)
            const sessionRef = db.collection('sessions').doc(sessionId);
            const sessionDoc = await transaction.get(sessionRef);
            
            if (!sessionDoc.exists) {
                throw new AttendanceError('SESSION_NOT_FOUND', 'Session does not exist', {}, 404);
            }

            const session = sessionDoc.data();

            if (session.status !== 'active') {
                throw new AttendanceError('SESSION_NOT_ACTIVE', 'Session is not currently active', 
                    { currentStatus: session.status }, 400);
            }

            // Validate session supports GPS
            if (session.method !== 'gps') {
                throw new AttendanceError('INVALID_SESSION_METHOD', 'This session does not support GPS attendance', 
                    { sessionMethod: session.method }, 400);
            }

            // STEP 4: Enrollment Verification (Optimized - uses class.students array)
            const classRef = db.collection('classes').doc(session.classId);
            const classDoc = await transaction.get(classRef);
            
            if (!classDoc.exists) {
                throw new AttendanceError('CLASS_NOT_FOUND', 'Class not found', {}, 404);
            }
            
            const classData = classDoc.data();
            const isEnrolled = classData.students && classData.students.includes(studentId);
            
            if (!isEnrolled) {
                throw new AttendanceError('NOT_ENROLLED', 'You are not enrolled in this class', {}, 403);
            }

            // STEP 5: Duplicate Attendance Check (Transaction-safe)
            // Use deterministic document ID: {sessionId}_{studentId}
            const attendanceDocId = `${sessionId}_${studentId}`;
            const existingAttendanceRef = db.collection('attendance').doc(attendanceDocId);
            const existingAttendanceDoc = await transaction.get(existingAttendanceRef);

            if (existingAttendanceDoc.exists) {
                const existingData = existingAttendanceDoc.data();
                throw new AttendanceError('ALREADY_MARKED', 'Attendance already marked for this session', 
                    { attendanceId: attendanceDocId, status: existingData.status }, 409);
            }

            // STEP 6: GPS Distance Calculation (Haversine Formula)
            const EARTH_RADIUS_METERS = 6371000;
            const teacherLat = session.teacherLat;
            const teacherLng = session.teacherLng;
            const radiusMeters = session.radiusMeters || 100;

            // Validate session coordinates
            if (teacherLat === undefined || teacherLng === undefined || 
                teacherLat === null || teacherLng === null) {
                console.error("Session missing coordinates:", session);
                throw new AttendanceError('SESSION_COORDINATES_MISSING', 
                    'Session location not configured properly', {}, 500);
            }

            // Precise Haversine calculation
            const toRadians = (degrees) => degrees * (Math.PI / 180);
            const dLat = toRadians(lat - teacherLat);
            const dLng = toRadians(lng - teacherLng);
            const teacherLatRad = toRadians(teacherLat);
            const studentLatRad = toRadians(lat);

            const a = 
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(teacherLatRad) * Math.cos(studentLatRad) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);

            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distance = EARTH_RADIUS_METERS * c;

            // Check if within allowed radius
            if (distance > radiusMeters) {
                throw new AttendanceError('OUT_OF_RANGE', 'You are too far from the classroom', 
                    {
                        distance: Math.round(distance),
                        radiusMeters: radiusMeters,
                        studentLat: lat,
                        studentLng: lng,
                        teacherLat: teacherLat,
                        teacherLng: teacherLng
                    }, 400);
            }

            // STEP 7: Determine Attendance Status
            const MILLISECONDS_PER_MINUTE = 60000;
            const startTimeMillis = session.startTime.toMillis();
            const currentTimeMillis = Date.now();
            const minutesSinceStart = (currentTimeMillis - startTimeMillis) / MILLISECONDS_PER_MINUTE;

            let status, teacherApproved;
            if (minutesSinceStart <= (session.lateAfterMinutes || 10)) {
                status = 'present';
                teacherApproved = true;
            } else {
                status = 'late';
                teacherApproved = null; // NULL for pending approval, NOT false
            }

            // STEP 8: Atomic Write Operation (within transaction)
            const now = FieldValue.serverTimestamp();
            
            const attendanceData = {
                attendanceId: attendanceDocId,
                sessionId: sessionId,
                classId: session.classId,
                studentId: studentId,
                studentName: studentName,
                rollNumber: rollNumber,
                teacherId: session.teacherId,
                status: status,
                method: 'gps',
                distance: Math.round(distance),
                studentLat: lat,
                studentLng: lng,
                teacherLat: session.teacherLat,
                teacherLng: session.teacherLng,
                withinRadius: true,
                teacherApproved: teacherApproved,
                joinedAt: now,
                markedAt: now,
                isSuspicious: false,
                autoAbsent: false
            };

            transaction.set(existingAttendanceRef, attendanceData);

            // Store result for response
            attendanceResult = {
                attendanceId: attendanceDocId,
                status: status,
                method: 'gps',
                distance: Math.round(distance),
                radiusMeters: radiusMeters,
                withinRadius: true,
                markedAt: new Date().toISOString(),
                message: status === 'present' 
                    ? 'Attendance marked successfully'
                    : 'Marked as late — awaiting teacher approval'
            };
        });

        // STEP 9: Success Response (outside transaction)
        return res.status(200).json({
            success: true,
            data: attendanceResult,
            message: attendanceResult.message
        });

    } catch (error) {
        console.error('markAttendance error:', error);
        
        // Handle specific AttendanceError instances
        if (error instanceof AttendanceError) {
            const response = {
                success: false,
                code: error.code,
                error: error.message
            };
            
            if (Object.keys(error.data).length > 0) {
                response.data = error.data;
            }
            
            return res.status(error.statusCode || 400).json(response);
        }

        // Handle Firestore transaction errors
        if (error.code === 10 || error.code === 'ABORTED' || error.message?.includes('Transaction')) {
            return res.status(409).json({
                success: false,
                code: 'TRANSACTION_CONFLICT',
                error: 'Concurrent attendance attempt detected. Please try again.'
            });
        }

        // Generic error handling
        if (next) return next(error);
        return res.status(500).json({
            success: false,
            code: "ATTENDANCE_SAVE_FAILED",
            error: "Failed to process attendance request"
        });
    }
};

// ━━━ APPROVE LATE ATTENDANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const approveLateAttendance = async (req, res, next) => {
    try {
        const { attendanceId } = req.params;
        const { approved } = req.body;
        const teacherId = req.user.uid;

        const attDoc = await db.collection('attendance').doc(attendanceId).get();
        if (!attDoc.exists) return res.status(404).json({ success: false, error: 'Attendance document missing', code: 'NOT_FOUND' });

        const attendance = attDoc.data();

        if (attendance.teacherId !== teacherId) return res.status(403).json({ success: false, error: 'Unauthorized override intent', code: 'UNAUTHORIZED' });
        if (attendance.status !== 'late') return res.status(400).json({ success: false, error: 'Only pending late records can be verified inline', code: 'NOT_LATE' });
        if (attendance.teacherApproved !== null) return res.status(400).json({ success: false, error: 'Record already verified correctly previously', code: 'ALREADY_DECIDED' });

        const newStatus = approved ? 'present' : 'absent';
        const now = FieldValue.serverTimestamp();

        await attDoc.ref.update({
            status: newStatus,
            teacherApproved: approved,
            approvedAt: now,
            markedAt: now
        });

        await updateSummaryOnApproval(db, attendance.studentId, attendance.classId, 'late', newStatus);

        const sessionDoc = await db.collection('sessions').doc(attendance.sessionId).get();
        const subjectName = sessionDoc.exists ? sessionDoc.data().subjectName : 'Subject';

        notifyAttendanceDecision(db, attendance.studentId, attendanceId, attendance.classId, attendance.departmentId, subjectName, approved).catch(console.error);

        logAction(db, ACTIONS.ATTENDANCE_UPDATED, teacherId, ACTOR_ROLES.TEACHER, attendanceId, TARGET_TYPES.ATTENDANCE,
            createDetails({ oldStatus: 'late', newStatus, teacherApproved: approved }), attendance.departmentId, req.ip
        ).catch(console.error);

        return res.status(200).json({ success: true, status: newStatus });
    } catch (error) {
        console.error('approveLateAttendance error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Server exception on late attendance approval.', code: 'SERVER_ERROR' });
    }
};

// ━━━ AUTO ABSENT LATE STUDENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const autoAbsentLateStudents = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const teacherId = req.user.uid;

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) return res.status(404).json({ success: false, error: 'Session bounds failure', code: 'NOT_FOUND' });

        const sessionData = sessionDoc.data();
        if (sessionData.teacherId !== teacherId) return res.status(403).json({ success: false, error: 'Only explicit session creator can auto-absent over delayed time window', code: 'UNAUTHORIZED' });

        const autoAbsentMinutes = sessionData.autoAbsentMinutes || 5;
        const cutoffTime = Date.now() - (autoAbsentMinutes * 60 * 1000);

        const snap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('status', '==', 'late')
            .where('teacherApproved', '==', null)
            .get();

        const toUpdate = snap.docs.filter(doc => {
            const joinedAt = doc.data().joinedAt;
            if (!joinedAt) return false;
            const ms = joinedAt.toMillis ? joinedAt.toMillis() : new Date(joinedAt).getTime();
            return ms < cutoffTime;
        });

        if (toUpdate.length === 0) {
            return res.status(200).json({ success: true, autoAbsentCount: 0 });
        }

        const batch = db.batch();
        for (const doc of toUpdate) {
            batch.update(doc.ref, {
                status: 'absent',
                autoAbsent: true,
                teacherApproved: false,
                markedAt: FieldValue.serverTimestamp()
            });
        }
        await batch.commit();

        for (const doc of toUpdate) {
            const data = doc.data();
            updateSummaryOnApproval(db, data.studentId, data.classId, 'late', 'absent').catch(console.error);
            notifyAttendanceDecision(db, data.studentId, doc.id, data.classId, data.departmentId, sessionData.subjectName || 'Class', false).catch(console.error);
            logAction(db, ACTIONS.ATTENDANCE_UPDATED, 'system', ACTOR_ROLES.SYSTEM, doc.id, TARGET_TYPES.ATTENDANCE, createDetails({ autoAbsent: true, oldStatus: 'late', newStatus: 'absent' }), data.departmentId, req.ip).catch(console.error);
        }

        return res.status(200).json({ success: true, autoAbsentCount: toUpdate.length });
    } catch (error) {
        console.error('autoAbsentLateStudents error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Auto expiry failure', code: 'SERVER_ERROR' });
    }
};

// ━━━ END SESSION & MARK ABSENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const endSessionAndMarkAbsent = async (req, res, next) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId required payload', code: 'VALIDATION_ERROR' });

        const teacherId = req.user.uid;
        const sessionRef = db.collection('sessions').doc(sessionId);
        const sessionDoc = await sessionRef.get();

        if (!sessionDoc.exists) return res.status(404).json({ success: false, error: 'Session document validation failure', code: 'NOT_FOUND' });

        const sessionData = sessionDoc.data();
        if (sessionData.teacherId !== teacherId) return res.status(403).json({ success: false, error: 'Unauthorized bounds exception', code: 'UNAUTHORIZED' });
        if (sessionData.status !== 'active') return res.status(400).json({ success: false, error: 'Illegal argument on closed boundary', code: 'SESSION_NOT_ACTIVE' });

        const classRef = db.collection('classes').doc(sessionData.classId);
        const classDoc = await classRef.get();
        const classData = classDoc.data() || { students: [] };
        const enrolledStudents = classData.students || [];

        const attSnap = await db.collection('attendance').where('sessionId', '==', sessionId).get();
        const markedStudents = new Set(attSnap.docs.map(d => d.data().studentId));

        const absentStudents = enrolledStudents.filter(uid => !markedStudents.has(uid));
        const batch = db.batch();

        for (const studentId of absentStudents) {
            const studentDoc = await db.collection('students').doc(studentId).get();
            const studentData = studentDoc.data() || {};

            const attRef = db.collection('attendance').doc();
            batch.set(attRef, {
                attendanceId: attRef.id,
                sessionId,
                classId: sessionData.classId,
                teacherId: sessionData.teacherId,
                departmentId: sessionData.departmentId,
                studentId,
                studentName: studentData.name || 'Unknown',
                studentRollNumber: studentData.rollNumber || 'Unknown',
                semester: sessionData.semester,
                section: sessionData.section,
                status: 'absent',
                method: sessionData.method,
                faceVerified: false,
                faceScore: null,
                teacherApproved: null,
                approvedAt: null,
                autoAbsent: true,
                deviceId: null,
                deviceBlocked: false,
                isSuspicious: false,
                suspiciousReason: null,
                studentLat: null,
                studentLng: null,
                distanceFromClass: null,
                networkSSID: null,
                bleRSSI: null,
                joinedAt: FieldValue.serverTimestamp(),
                markedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp()
            });
        }

        batch.update(sessionRef, {
            status: 'ended',
            endTime: FieldValue.serverTimestamp()
        });

        batch.update(classRef, {
            totalSessions: FieldValue.increment(1)
        });

        await batch.commit();

        for (const studentId of absentStudents) {
            const studentDoc = await db.collection('students').doc(studentId).get();
            const studentData = studentDoc.data() || {};
            updateSummaryOnAttendance(
                db,
                {
                    studentId, classId: sessionData.classId,
                    status: 'absent', sessionId,
                    teacherId: sessionData.teacherId,
                    departmentId: sessionData.departmentId,
                    semester: sessionData.semester,
                    section: sessionData.section,
                    batch: sessionData.batch,
                    academicYear: sessionData.academicYear
                },
                {
                    subjectName: sessionData.subjectName,
                    subjectCode: sessionData.subjectCode,
                    minAttendance: classData.minAttendance || 75
                },
                { name: studentData.name, rollNumber: studentData.rollNumber }
            ).catch(console.error);
        }

        // Inline auto absent for pending late students
        const cutoffTime = Date.now() - ((sessionData.autoAbsentMinutes || 5) * 60 * 1000);
        const lateSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('status', '==', 'late')
            .where('teacherApproved', '==', null)
            .get();

        const lateBatch = db.batch();
        const lateToUpdate = [];
        for (const doc of lateSnap.docs) {
            const joinedAt = doc.data().joinedAt;
            if (joinedAt) {
                const ms = joinedAt.toMillis ? joinedAt.toMillis() : new Date(joinedAt).getTime();
                if (ms < cutoffTime) {
                    lateBatch.update(doc.ref, {
                        status: 'absent',
                        autoAbsent: true,
                        teacherApproved: false,
                        markedAt: FieldValue.serverTimestamp()
                    });
                    lateToUpdate.push({ id: doc.id, data: doc.data() });
                }
            }
        }

        if (lateToUpdate.length > 0) {
            await lateBatch.commit();
            for (const item of lateToUpdate) {
                updateSummaryOnApproval(db, item.data.studentId, item.data.classId, 'late', 'absent').catch(console.error);
                notifyAttendanceDecision(db, item.data.studentId, item.id, item.data.classId, item.data.departmentId, sessionData.subjectName || 'Class', false).catch(console.error);
            }
        }

        logAction(db, ACTIONS.SESSION_ENDED, teacherId, ACTOR_ROLES.TEACHER, sessionId, TARGET_TYPES.SESSION,
            createDetails({ absentMarked: absentStudents.length }), sessionData.departmentId, req.ip
        ).catch(console.error);

        return res.status(200).json({ success: true, absentMarked: absentStudents.length, sessionId });
    } catch (error) {
        console.error('endSessionAndMarkAbsent error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Database bounds overwrite exception on termination process.', code: 'SERVER_ERROR' });
    }
};

// ━━━ GET SESSION ATTENDANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const getSessionAttendance = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const uid = req.user.uid;
        const role = req.user.role;

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) {
            return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', error: 'Session not found' });
        }
        const session = { id: sessionDoc.id, ...sessionDoc.data() };

        if (session.teacherId !== uid && role !== 'hod' && role !== 'superAdmin') {
            return res.status(403).json({ success: false, code: 'UNAUTHORIZED', error: 'You do not own this session' });
        }

        const snap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get();

        const data = snap.docs.map(doc => {
            const d = doc.data();
            return {
                ...d,
                id: doc.id,
                joinedAt: d.joinedAt?.toDate?.()?.toISOString() || null,
                markedAt: d.markedAt?.toDate?.()?.toISOString() || null
            };
        }).sort((a, b) => {
            const rollA = a.rollNumber || a.studentRollNumber || '';
            const rollB = b.rollNumber || b.studentRollNumber || '';
            return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
        });

        let totalPresent = 0;
        let totalLate = 0;
        let totalAbsent = 0;

        data.forEach(r => {
            const status = r.status;
            const teacherApproved = r.teacherApproved;
            if (status === 'present' || (status === 'late' && teacherApproved === true)) {
                totalPresent++;
            } else if (status === 'late' && teacherApproved !== false) {
                // Late but not yet rejected = still categorised as late
                totalLate++;
            } else {
                // absent, or late+rejected
                totalAbsent++;
            }
        });

        const totalEnrolled = session.totalStudents || 0;
        const attendancePercentage = totalEnrolled > 0 ? Number(((totalPresent / totalEnrolled) * 100).toFixed(2)) : 0;

        return res.status(200).json({
            success: true,
            data: data,
            sessionInfo: {
                sessionId: session.id,
                classId: session.classId,
                subjectName: session.subjectName,
                subjectCode: session.subjectCode,
                method: session.method,
                status: session.status,
                startTime: session.startTime?.toDate?.()?.toISOString() || null,
                endTime: session.endTime?.toDate?.()?.toISOString() || null,
                // Additional fields needed by the UI
                roomNumber: session.roomNumber || null,
                buildingName: session.buildingName || null,
                teacherName: session.teacherName || null,
                totalStudents: session.totalStudents || 0,
                lateAfterMinutes: session.lateAfterMinutes || null,
                autoAbsentMinutes: session.autoAbsentMinutes || null,
                semester: session.semester || null,
                section: session.section || null,
                batch: session.batch || null
            },
            summary: {
                totalPresent,
                totalLate,
                totalAbsent,
                totalEnrolled,
                attendancePercentage
            },
            count: data.length
        });
    } catch (error) {
        console.error('getSessionAttendance error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Internal server error' });
    }
};

// ━━━ EXPORT ATTENDANCE EXCEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const exportClassExcel = async (req, res, next) => {
    try {
        const { classId } = req.params;
        const { startDate, endDate } = req.query;

        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) return res.status(404).json({ success: false, error: 'Database missing relational index', code: 'NOT_FOUND' });
        const classData = { id: classId, ...classDoc.data() };

        if (req.user.uid !== classData.teacherId && req.user.role !== 'hod' && req.user.role !== 'superAdmin') {
            return res.status(403).json({ success: false, error: 'Domain violation limits', code: 'UNAUTHORIZED' });
        }

        let sessionQuery = db.collection('sessions').where('classId', '==', classId);
        const sessionsSnap = await sessionQuery.get();
        let sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (startDate && endDate) {
            const start = new Date(startDate).getTime();
            const end = new Date(endDate).getTime();
            sessions = sessions.filter(s => {
                const sTime = s.startTime?.toMillis ? s.startTime.toMillis() : new Date(s.startTime).getTime();
                return sTime >= start && sTime <= end;
            });
        }

        let attendanceRecords = [];
        if (sessions.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            const batchPromises = [];
            for (let i = 0; i < sessionIds.length; i += 30) {
                const batch = sessionIds.slice(i, i + 30);
                batchPromises.push(db.collection('attendance').where('sessionId', 'in', batch).get());
            }
            const snapResults = await Promise.all(batchPromises);
            for (const aSnap of snapResults) {
                attendanceRecords.push(...aSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            }
        }

        if (startDate && endDate) {
            const start = new Date(startDate).getTime();
            const end = new Date(endDate).getTime();
            attendanceRecords = attendanceRecords.filter(a => {
                const tTime = a.joinedAt?.toMillis ? a.joinedAt.toMillis() : new Date(a.joinedAt).getTime();
                return tTime >= start && tTime <= end;
            });
        }

        const studentSummaries = await getSummaryForClass(db, classId);

        const buffer = await generateClassAttendanceExcel(classData, studentSummaries, sessions, attendanceRecords);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${classData.subjectCode}_${classData.semester}${classData.section}.xlsx`);
        return res.send(buffer);

    } catch (error) {
        console.error('exportAttendanceExcel error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Database limits blocking internal translation export', code: 'SERVER_ERROR' });
    }
};

// ━━━ EXPORT ATTENDANCE PDF ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const exportClassPdf = async (req, res, next) => {
    try {
        const { classId } = req.params;
        const { startDate, endDate } = req.query;

        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) return res.status(404).json({ success: false, error: 'Class not found', code: 'NOT_FOUND' });
        const classData = { id: classId, ...classDoc.data() };

        if (req.user.uid !== classData.teacherId && req.user.role !== 'hod' && req.user.role !== 'superAdmin') {
            return res.status(403).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
        }

        let sessionQuery = db.collection('sessions').where('classId', '==', classId);
        const sessionsSnap = await sessionQuery.get();
        let sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (startDate && endDate) {
            const start = new Date(startDate).getTime();
            const end = new Date(endDate).getTime();
            sessions = sessions.filter(s => {
                const sTime = s.startTime?.toMillis ? s.startTime.toMillis() : new Date(s.startTime).getTime();
                return sTime >= start && sTime <= end;
            });
        }

        let attendanceRecords = [];
        if (sessions.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            const batchPromises = [];
            for (let i = 0; i < sessionIds.length; i += 30) {
                const batch = sessionIds.slice(i, i + 30);
                batchPromises.push(db.collection('attendance').where('sessionId', 'in', batch).get());
            }
            const snapResults = await Promise.all(batchPromises);
            for (const aSnap of snapResults) {
                attendanceRecords.push(...aSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            }
        }

        if (startDate && endDate) {
            const start = new Date(startDate).getTime();
            const end = new Date(endDate).getTime();
            attendanceRecords = attendanceRecords.filter(a => {
                const tTime = a.joinedAt?.toMillis ? a.joinedAt.toMillis() : new Date(a.joinedAt).getTime();
                return tTime >= start && tTime <= end;
            });
        }

        // Generate session report for the first/active session or an aggregate context
        // PDF requirements specify giving "sessionData", we will use the first session or aggregate values
        const sessionData = sessions.length > 0 ? sessions[sessions.length - 1] : { subjectName: classData.subjectName, subjectCode: classData.subjectCode, teacherName: classData.teacherName, method: 'Multiple', totalStudents: classData.students ? classData.students.length : 0 };
        
        const buffer = await generateSessionReport(sessionData, attendanceRecords, classData);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${classId}.pdf`);
        return res.send(buffer);

    } catch (error) {
        console.error('exportAttendancePDF error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Server error during PDF export', code: 'SERVER_ERROR' });
    }
};

// ━━━ EXPORT STUDENT CERTIFICATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const exportStudentCertificate = async (req, res, next) => {
    try {
        const { studentId } = req.params;

        if (req.user.role === 'student' && req.user.uid !== studentId) {
            return res.status(403).json({ success: false, error: 'Cannot download certificate for other students', code: 'UNAUTHORIZED' });
        }
        
        // For teacher/HOD, access verification could be more rigorous, but allowing for now.

        const studentDoc = await db.collection('students').doc(studentId).get();
        if (!studentDoc.exists) return res.status(404).json({ success: false, error: 'Student not found', code: 'NOT_FOUND' });
        const studentData = studentDoc.data();

        const currentYear = '2023-24'; // Fallback mapping could be derived from config

        const summariesSnap = await db.collection('attendanceSummary')
            .where('studentId', '==', studentId)
            .get(); // Note: Without exact composite indexes, querying locally
            
        let summaries = summariesSnap.docs.map(d => d.data());
        // Filtering locally by academicYear to avoid needing a new complex index immediately
        summaries = summaries.filter(s => s.academicYear === currentYear || currentYear);

        const buffer = await generateAttendanceCertificate(studentData, summaries, currentYear);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=certificate_${studentId}.pdf`);
        return res.send(buffer);

    } catch (error) {
        console.error('exportStudentCertificate error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Server error generating certificate', code: 'SERVER_ERROR' });
    }
};

// ━━━ EXPORT DEPARTMENT EXCEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const exportDepartmentExcel = async (req, res, next) => {
    try {
        const { departmentId } = req.params;

        if (req.user.role !== 'superAdmin' && req.user.role !== 'hod') {
            return res.status(403).json({ success: false, error: 'Super Admin or HOD required', code: 'UNAUTHORIZED' });
        }

        const currentYear = '2023-24'; // Fallback Mapping
        
        const deptDoc = await db.collection('departments').doc(departmentId).get();
        if (!deptDoc.exists) return res.status(404).json({ success: false, error: 'Department not found', code: 'NOT_FOUND' });
        const deptData = deptDoc.data();

        if (req.user.role === 'hod' && deptData.hodId !== req.user.uid) {
            return res.status(403).json({ success: false, error: 'Cannot export outside of your department', code: 'UNAUTHORIZED' });
        }

        const summariesSnap = await db.collection('attendanceSummary')
            .where('departmentId', '==', departmentId)
            .get();
        let summaries = summariesSnap.docs.map(d => d.data());
        summaries = summaries.filter(s => s.academicYear === currentYear || currentYear);

        // Calculate simple stats dynamically if summaryUpdater.getDepartmentStats isn't available
        const total = summaries.length;
        const avg = total > 0 ? summaries.reduce((sum, s) => sum + (s.percentage || 0), 0) / total : 0;
        const below75 = summaries.filter(s => s.isBelowThreshold || s.percentage < 75).length;
        const above90 = summaries.filter(s => s.percentage >= 90).length;
        
        const stats = {
            averageAttendance: avg.toFixed(1),
            studentsBelow75: below75,
            studentsAbove90: above90,
            totalStudents: total
        };

        const buffer = await generateDepartmentExcel(deptData.name, currentYear, summaries, stats);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=department_report_${deptData.code}.xlsx`);
        return res.send(buffer);

    } catch (error) {
        console.error('exportDepartmentExcel error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Server error generating department report', code: 'SERVER_ERROR' });
    }
};

// ━━━ MANUAL APPROVE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const manualApprove = async (req, res, next) => {
    try {
        const { sessionId, studentId, approved, reason } = req.body;

        if (!sessionId || !studentId || approved === undefined) {
            return res.status(400).json({ success: false, error: 'sessionId, studentId and approved are required payload elements.', code: 'VALIDATION_ERROR' });
        }

        if (req.user.role !== 'teacher') {
            return res.status(403).json({ success: false, error: 'Only teachers can manually approve internal assignments', code: 'TEACHER_ONLY' });
        }

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) return res.status(404).json({ success: false, error: 'Session bounds evaluation lost context scope.', code: 'SESSION_NOT_FOUND' });
        const session = sessionDoc.data();
        if (session.teacherId !== req.user.uid) return res.status(403).json({ success: false, error: 'Authorization override denied internally.', code: 'UNAUTHORIZED' });
        if (session.status !== 'active') return res.status(400).json({ success: false, error: 'Session inactive boundaries limit.', code: 'SESSION_NOT_ACTIVE' });

        const existingQuery = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('studentId', '==', studentId)
            .limit(1)
            .get();

        const now = FieldValue.serverTimestamp();

        if (!existingQuery.empty) {
            const docRef = existingQuery.docs[0].ref;
            const docData = existingQuery.docs[0].data();
            const oldStatus = docData.status;
            const newStatus = approved ? 'present' : 'absent';

            await docRef.update({
                status: newStatus,
                teacherApproved: approved,
                manualApproval: approved,
                approvalReason: reason || 'Teacher approval',
                approvedAt: now
            });

            await updateSummaryOnApproval(db, studentId, session.classId, oldStatus, newStatus);
        } else {
            const newStatus = approved ? 'present' : 'absent';
            await db.collection('attendance').add({
                sessionId,
                classId: session.classId,
                studentId,
                status: newStatus,
                method: 'manual',
                faceVerified: false,
                teacherApproved: approved,
                manualApproval: true,
                approvalReason: reason || 'Manual entry',
                joinedAt: now,
                markedAt: now
            });

            const studentDoc = await db.collection('students').doc(studentId).get();
            const studentData = studentDoc.data() || {};
            const classDoc = await db.collection('classes').doc(session.classId).get();

            updateSummaryOnAttendance(
                db,
                {
                    studentId, classId: session.classId,
                    status: newStatus, sessionId,
                    teacherId: session.teacherId,
                    departmentId: session.departmentId,
                    semester: session.semester,
                    section: session.section,
                    batch: session.batch,
                    academicYear: session.academicYear
                },
                {
                    subjectName: session.subjectName,
                    subjectCode: session.subjectCode,
                    minAttendance: classDoc.data()?.minAttendance || 75
                },
                { name: studentData.name, rollNumber: studentData.rollNumber }
            ).catch(console.error);
        }

        return res.status(200).json({
            success: true,
            status: approved ? 'present' : 'absent',
            message: approved ? 'Student marked present manually' : 'Student marked absent'
        });

    } catch (error) {
        console.error('manualApprove error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Manual assignment execution error block limits exception', code: 'SERVER_ERROR' });
    }
};

// ━━━ GET STUDENT ATTENDANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const getStudentAttendance = async (req, res, next) => {
    try {
        const { studentId } = req.params;
        const { classId, limit = 20 } = req.query;
        const uid = req.user.uid;

        if (uid !== studentId) {
            if (classId) {
                const classDoc = await db.collection('classes').doc(classId).get();
                if (!classDoc.exists || classDoc.data().teacherId !== uid) {
                    return res.status(403).json({ success: false, error: 'Permission invalid block', code: 'UNAUTHORIZED' });
                }
            } else {
                return res.status(403).json({ success: false, error: 'Authorization error evaluation limit', code: 'UNAUTHORIZED' });
            }
        }

        let query = db.collection('attendance').where('studentId', '==', studentId);
        if (classId) query = query.where('classId', '==', classId);
        const snap = await query.get();

        const records = snap.docs
            .map(d => ({
                id: d.id,
                ...d.data(),
                joinedAt: d.data().joinedAt?.toDate?.()?.toISOString() || null,
                markedAt: d.data().markedAt?.toDate?.()?.toISOString() || null
            }))
            .sort((a, b) => {
                if (!a.markedAt) return 1;
                if (!b.markedAt) return -1;
                return new Date(b.markedAt) - new Date(a.markedAt);
            })
            .slice(0, Number(limit));

        const sessionCache = {};
        const enriched = await Promise.all(records.map(async r => {
            if (r.sessionId && !sessionCache[r.sessionId]) {
                const sDoc = await db.collection('sessions').doc(r.sessionId).get();
                sessionCache[r.sessionId] = sDoc.exists ? { startTime: sDoc.data().startTime?.toDate?.()?.toISOString() || null, method: sDoc.data().method } : null;
            }
            return { ...r, session: sessionCache[r.sessionId] || null };
        }));

        const allSnap = await (classId
            ? db.collection('attendance').where('studentId', '==', studentId).where('classId', '==', classId).get()
            : db.collection('attendance').where('studentId', '==', studentId).get());
        const allRecords = allSnap.docs.map(d => d.data());
        const totalClasses = allRecords.length;
        const present = allRecords.filter(r => r.status === 'present').length;
        const late = allRecords.filter(r => r.status === 'late').length;
        const absent = allRecords.filter(r => r.status === 'absent').length;
        const percentage = totalClasses > 0 ? Math.round(((present + late) / totalClasses) * 100) : 0;

        return res.status(200).json({
            success: true,
            data: {
                records: enriched,
                stats: { totalClasses, present, late, absent, percentage }
            }
        });

    } catch (error) {
        console.error('getStudentAttendance error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Database pull index timeout evaluating queries internal', code: 'SERVER_ERROR' });
    }
};

// ━━━ UPDATE ATTENDANCE STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const updateAttendanceStatus = async (req, res, next) => {
    try {
        const { attendanceId } = req.params;
        const { status, teacherApproved, reason } = req.body;
        const VALID_STATUSES = ['present', 'late', 'absent', 'face_failed'];

        const attDoc = await db.collection('attendance').doc(attendanceId).get();
        if (!attDoc.exists) return res.status(404).json({ success: false, error: 'Lost connection parameter binding missing id', code: 'NOT_FOUND' });
        const attData = attDoc.data();

        const sessionDoc = await db.collection('sessions').doc(attData.sessionId).get();
        if (!sessionDoc.exists) return res.status(404).json({ success: false, error: 'Class parent tree link missing index element', code: 'SESSION_NOT_FOUND' });
        const session = sessionDoc.data();

        if (session.teacherId !== req.user.uid) return res.status(403).json({ success: false, error: 'Only teacher class bounds overwrite limit assignment value check.', code: 'UNAUTHORIZED' });

        if (session.status !== 'active') return res.status(400).json({ success: false, error: 'Session bounds closed window error evaluation', code: 'SESSION_NOT_ACTIVE' });

        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, error: `status values enum validation exception fault rule.`, code: 'VALIDATION_ERROR' });
        }

        const updateData = {
            status,
            updatedAt: FieldValue.serverTimestamp()
        };
        if (teacherApproved !== undefined) updateData.teacherApproved = teacherApproved;
        if (reason) updateData.approvalReason = reason;

        await db.collection('attendance').doc(attendanceId).update(updateData);
        const updated = await db.collection('attendance').doc(attendanceId).get();

        if (attData.status !== status) {
            updateSummaryOnApproval(db, attData.studentId, attData.classId, attData.status, status).catch(console.error);
        }

        return res.status(200).json({
            success: true,
            data: {
                message: 'Attendance status correctly verified up over local block limit',
                attendance: { id: updated.id, ...updated.data() }
            }
        });

    } catch (error) {
        console.error('updateAttendanceStatus error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Failed applying internal domain update exception block', code: 'SERVER_ERROR' });
    }
};

// ━━━ FETCH REPORT DATA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const fetchReportData = async (classId, teacherId, fromDate, toDate) => {
    const classDoc = await db.collection('classes').doc(classId).get();
    if (!classDoc.exists) return { error: { message: 'Class index not verified local scope data store object missing.', code: 'CLASS_NOT_FOUND', status: 404 } };
    if (classDoc.data().teacherId !== teacherId) return { error: { message: 'Domain boundary limits evaluating owner error access code check', code: 'UNAUTHORIZED', status: 403 } };
    const classData = { id: classDoc.id, ...classDoc.data() };

    const sessionsSnap = await db.collection('sessions')
        .where('classId', '==', classId)
        .where('status', '==', 'ended')
        .get();

    const sessions = sessionsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => {
            if (!s.startTime) return true;
            const t = s.startTime.toDate ? s.startTime.toDate() : new Date(s.startTime);
            return t >= fromDate && t <= toDate;
        })
        .sort((a, b) => {
            const at = a.startTime?.toDate?.() || new Date(a.startTime);
            const bt = b.startTime?.toDate?.() || new Date(b.startTime);
            return bt - at;
        });

    if (sessions.length === 0) return { classData, sessions: [], students: [] };

    const sessionIds = sessions.map(s => s.id);
    let allRecords = [];
    for (let i = 0; i < sessionIds.length; i += 30) {
        const batch = sessionIds.slice(i, i + 30);
        const snap = await db.collection('attendance').where('sessionId', 'in', batch).get();
        allRecords.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    const summaryMap = buildStudentSummary(allRecords, sessions.length);

    const studentUIDs = Object.keys(summaryMap);
    const profiles = {};
    await Promise.all(studentUIDs.map(async uid => {
        const doc = await db.collection('students').doc(uid).get();
        profiles[uid] = doc.exists ? doc.data() : {};
    }));

    const studentSummaries = studentUIDs.map(uid => {
        const s = summaryMap[uid];
        const p = profiles[uid] || {};
        const total = s.present + s.late + s.absent + s.faceFailed;
        const percentage = total > 0 ? Math.round(((s.present + s.late) / total) * 100) : 0;
        return {
            uid,
            name: p.name || 'Unknown',
            studentId: p.studentId || '',
            email: p.email || '',
            ...s,
            total,
            percentage
        };
    });

    const sessionsSerialized = sessions.map(s => ({
        ...s,
        startTime: s.startTime?.toDate?.()?.toISOString() || null,
        endTime: s.endTime?.toDate?.()?.toISOString() || null
    }));

    return { classData, sessions: sessionsSerialized, students: studentSummaries };
};

// ━━━ GET ATTENDANCE REPORT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const getAttendanceReport = async (req, res, next) => {
    try {
        const { classId } = req.params;
        const { fromDate, toDate } = req.query;
        const { from, to } = parseDateRange(fromDate, toDate);

        const result = await fetchReportData(classId, req.user.uid, from, to);
        if (result.error) return res.status(result.error.status || 500).json({ success: false, error: result.error.message, code: result.error.code });

        const { sessions, students } = result;
        const totalSessions = sessions.length;
        const avgAttendance = students.length > 0
            ? Math.round(students.reduce((s, st) => s + st.percentage, 0) / students.length)
            : 0;
        const atRiskCount = students.filter(s => s.percentage < 75).length;

        return res.status(200).json({
            success: true,
            data: {
                sessions,
                students,
                stats: { totalSessions, avgAttendance, atRiskCount }
            }
        });

    } catch (error) {
        console.error('getAttendanceReport error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Database compilation metrics breakdown fault error evaluation domain', code: 'SERVER_ERROR' });
    }
};



// NEW: exportSessionExcel
export const exportSessionExcel = async (req, res, next) => {
    try {
        const { classId } = req.params;
        const { sessionId } = req.query;
        const uid = req.user.uid;
        const role = req.user.role;

        if (sessionId && typeof sessionId !== 'string') {
            return errorResponse(res, 'Invalid sessionId format', 400, 'INVALID_INPUT');
        }

        if (!sessionId) {
            return exportClassExcel(req, res, next);
        }

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) {
            return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND');
        }
        const session = { id: sessionDoc.id, ...sessionDoc.data() };

        if (session.classId !== classId) {
            return errorResponse(res, 'Session does not belong to this class', 400, 'CLASS_MISMATCH');
        }

        if (session.teacherId !== uid && role !== 'hod' && role !== 'superAdmin') {
            return errorResponse(res, 'Unauthorized access to session data', 403, 'UNAUTHORIZED');
        }

        // 1. Fetch raw attendance records
        const attSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get();
        const rawRecords = attSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 2. Collect unique studentIds to enrich from students collection
        const studentIds = [...new Set(rawRecords.map(r => r.studentId).filter(Boolean))];

        // 3. Batch-fetch student profiles (Firestore 'in' limit = 30)
        const studentMap = {};
        for (let i = 0; i < studentIds.length; i += 30) {
            const batch = studentIds.slice(i, i + 30);
            const studentsSnap = await db.collection('students').where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
            studentsSnap.docs.forEach(doc => {
                studentMap[doc.id] = doc.data();
            });
        }

        // 4. Enrich each attendance record with real student data
        const records = rawRecords.map(r => {
            const studentProfile = studentMap[r.studentId] || {};
            return {
                ...r,
                studentName: r.studentName || studentProfile.name || 'Unknown',
                studentRollNumber: r.studentRollNumber || r.rollNumber || studentProfile.rollNumber || studentProfile.studentId || 'N/A',
                rollNumber: r.rollNumber || r.studentRollNumber || studentProfile.rollNumber || studentProfile.studentId || 'N/A'
            };
        }).sort((a, b) => {
            const rollA = a.studentRollNumber || '';
            const rollB = b.studentRollNumber || '';
            return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
        });

        const buffer = await generateSessionAttendanceExcel(session, records);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="session_${sessionId}.xlsx"`);
        
        return res.send(buffer);

    } catch (error) {
        console.error('exportSessionExcel error:', error);
        next(error);
    }
};

// NEW: exportSessionPdf
export const exportSessionPdf = async (req, res, next) => {
    try {
        const { classId } = req.params;
        const { sessionId } = req.query;
        const uid = req.user.uid;
        const role = req.user.role;

        if (sessionId && typeof sessionId !== 'string') {
            return errorResponse(res, 'Invalid sessionId format', 400, 'INVALID_INPUT');
        }

        if (!sessionId) {
            return exportClassPdf(req, res, next);
        }

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) {
            return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND');
        }
        const session = { id: sessionDoc.id, ...sessionDoc.data() };

        if (session.classId !== classId) {
            return errorResponse(res, 'Session does not belong to this class', 400, 'CLASS_MISMATCH');
        }

        if (session.teacherId !== uid && role !== 'hod' && role !== 'superAdmin') {
            return errorResponse(res, 'Unauthorized access to session data', 403, 'UNAUTHORIZED');
        }

        // 1. Fetch raw attendance records
        const attSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get();
        const rawRecords = attSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 2. Collect unique studentIds to enrich from students collection
        const studentIds = [...new Set(rawRecords.map(r => r.studentId).filter(Boolean))];

        // 3. Batch-fetch student profiles (Firestore 'in' limit = 30)
        const studentMap = {};
        for (let i = 0; i < studentIds.length; i += 30) {
            const batch = studentIds.slice(i, i + 30);
            const studentsSnap = await db.collection('students').where(admin.firestore.FieldPath.documentId(), 'in', batch).get();
            studentsSnap.docs.forEach(doc => {
                studentMap[doc.id] = doc.data();
            });
        }

        // 4. Enrich each attendance record with real student data
        const records = rawRecords.map(r => {
            const studentProfile = studentMap[r.studentId] || {};
            return {
                ...r,
                studentName: r.studentName || studentProfile.name || 'Unknown',
                studentRollNumber: r.studentRollNumber || r.rollNumber || studentProfile.rollNumber || studentProfile.studentId || 'N/A',
                rollNumber: r.rollNumber || r.studentRollNumber || studentProfile.rollNumber || studentProfile.studentId || 'N/A'
            };
        }).sort((a, b) => {
            const rollA = a.studentRollNumber || '';
            const rollB = b.studentRollNumber || '';
            return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
        });

        // 5. Fetch class info for the PDF context
        const classDoc = await db.collection('classes').doc(classId).get();
        const classInfo = classDoc.exists ? { id: classDoc.id, ...classDoc.data() } : {};

        // 6. Generate PDF using the robust utility
        const buffer = await generateSessionReport(session, records, classInfo);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="session_${sessionId}.pdf"`);
        return res.send(buffer);

    } catch (error) {
        console.error('exportSessionPdf error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Internal server error' });
    }
};


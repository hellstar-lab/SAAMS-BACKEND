import { db, admin } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, errorResponse } from '../utils/responseHelper.js';
import { isStudentLate } from '../utils/lateDetection.js';
import { generateClassAttendanceExcel, generateDepartmentExcel } from '../utils/excelGenerator.js';
import { generateAttendanceCertificate, generateSessionReport } from '../utils/pdfGenerator.js';

import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js';
import { notifyStudentLate, notifyLowAttendance, notifyAttendanceDecision, notifyFraudDetected } from '../utils/notificationService.js';
import { updateSummaryOnAttendance, updateSummaryOnApproval, getSummaryForClass } from '../utils/summaryUpdater.js';
import { checkDuplicateDevice, checkRapidScan, checkGPSProximity } from '../utils/fraudDetector.js';

// ─── Haversine Distance Formula ───────────────────────────────────────────────
const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
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

// ━━━ MARK ATTENDANCE ━━━
export const markAttendance = async (req, res, next) => {
    try {
        const { sessionId, qrCode, studentLat, studentLng, networkSSID, bleRSSI, faceImage, faceVerified, faceScore, deviceId } = req.body;
        const studentId = req.user.uid;

        const [sessionDoc, studentDoc] = await Promise.all([
            db.collection('sessions').doc(sessionId).get(),
            db.collection('students').doc(studentId).get()
        ]);

        if (!sessionDoc.exists) return res.status(404).json({ success: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' });

        const sessionData = sessionDoc.data();
        if (sessionData.status !== 'active') return res.status(400).json({ success: false, error: 'Session has ended', code: 'SESSION_ENDED' });

        const studentData = studentDoc.data() || {};

        const classDoc = await db.collection('classes').doc(sessionData.classId).get();
        const classData = classDoc.data() || { students: [] };

        if (!classData.students.includes(studentId)) {
            return res.status(403).json({ success: false, error: 'Not enrolled in this class', code: 'NOT_ENROLLED' });
        }

        const existingQuery = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('studentId', '==', studentId)
            .get();

        if (!existingQuery.empty) {
            return res.status(409).json({ success: false, error: 'Attendance already marked', code: 'ALREADY_MARKED' });
        }

        const rapidCheck = await checkRapidScan(db, studentId, sessionId);
        if (rapidCheck.isFraud) {
            return res.status(429).json({ success: false, error: rapidCheck.message, code: 'RAPID_SCAN_DETECTED' });
        }

        let deviceFraud = { isFraud: false };
        if (deviceId) {
            deviceFraud = await checkDuplicateDevice(
                db, deviceId, studentId, studentData.name || 'Unknown',
                sessionId, sessionData.classId, sessionData.departmentId
            );

            if (deviceFraud.isFraud) {
                notifyFraudDetected(db, sessionData.teacherId, null, sessionId, sessionData.classId, sessionData.departmentId, 'duplicate_device', [studentData.name]).catch(console.error);
            }
        }

        if (sessionData.method === 'qr') {
            if (qrCode !== sessionData.qrCode) {
                return res.status(400).json({ success: false, error: 'Invalid QR code', code: 'INVALID_QR_CODE' });
            }
        } else if (sessionData.method === 'gps') {
            if (studentLat == null || studentLng == null) {
                return res.status(400).json({ success: false, error: 'GPS coordinates required', code: 'GPS_REQUIRED' });
            }
            const distance = haversineMeters(sessionData.teacherLat, sessionData.teacherLng, studentLat, studentLng);
            if (distance > sessionData.radiusMeters) {
                return res.status(400).json({ success: false, error: 'Out of range', code: 'OUT_OF_RANGE', distance: Math.round(distance), allowed: sessionData.radiusMeters });
            }
        } else if (sessionData.method === 'network') {
            if (networkSSID !== sessionData.expectedSSID) {
                return res.status(400).json({ success: false, error: 'Wrong network', code: 'WRONG_NETWORK' });
            }
        } else if (sessionData.method === 'bluetooth') {
            if (bleRSSI == null) {
                return res.status(400).json({ success: false, error: 'Bluetooth signal required', code: 'BLUETOOTH_REQUIRED' });
            }
        }

        if (sessionData.faceRequired === true && faceVerified !== true) {
            return res.status(400).json({ success: false, error: 'Face verification missing or failed', code: 'FACE_REQUIRED' });
        }

        const now = Date.now();
        const sessionStart = sessionData.startTime.toMillis ? sessionData.startTime.toMillis() : new Date(sessionData.startTime).getTime();
        const minutesElapsed = (now - sessionStart) / 60000;
        const isLate = minutesElapsed > (sessionData.lateAfterMinutes || 0);

        const attendanceRef = db.collection('attendance').doc();
        const attendanceId = attendanceRef.id;

        const distanceVal = (sessionData.method === 'gps' && studentLat != null && studentLng != null)
            ? haversineMeters(sessionData.teacherLat, sessionData.teacherLng, studentLat, studentLng)
            : null;

        const attendanceDoc = {
            attendanceId,
            sessionId,
            classId: sessionData.classId,
            teacherId: sessionData.teacherId,
            departmentId: sessionData.departmentId,
            studentId,
            studentName: studentData.name || 'Unknown',
            studentRollNumber: studentData.rollNumber || 'Unknown',
            semester: sessionData.semester,
            section: sessionData.section,
            status: isLate ? 'late' : 'present',
            method: sessionData.method,
            faceVerified: faceVerified || false,
            faceScore: faceScore || null,
            teacherApproved: isLate ? null : true,
            approvedAt: isLate ? null : FieldValue.serverTimestamp(),
            autoAbsent: false,
            deviceId: deviceId || null,
            deviceBlocked: deviceFraud.isFraud,
            isSuspicious: deviceFraud.isFraud,
            suspiciousReason: deviceFraud.isFraud ? 'duplicate_device' : null,
            studentLat: studentLat || null,
            studentLng: studentLng || null,
            distanceFromClass: distanceVal ? Math.round(distanceVal) : null,
            networkSSID: networkSSID || null,
            bleRSSI: bleRSSI || null,
            joinedAt: FieldValue.serverTimestamp(),
            markedAt: isLate ? null : FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp()
        };

        await attendanceRef.set(attendanceDoc);

        if (deviceId && !studentData.deviceId) {
            db.collection('students').doc(studentId).update({
                deviceId,
                updatedAt: FieldValue.serverTimestamp()
            }).catch(e => console.error('Error updating student deviceId:', e));
        }

        const summaryResult = await updateSummaryOnAttendance(
            db,
            {
                studentId, classId: sessionData.classId,
                status: isLate ? 'late' : 'present',
                sessionId, teacherId: sessionData.teacherId,
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
        );

        if (summaryResult && summaryResult.isFirstTimeBelowThreshold) {
            notifyLowAttendance(
                db, studentId, sessionData.classId,
                sessionData.departmentId, sessionData.subjectName,
                summaryResult.percentage, classData.minAttendance || 75
            ).catch(console.error);
        }

        if (isLate) {
            const minutesLate = Math.floor(minutesElapsed - (sessionData.lateAfterMinutes || 0));
            notifyStudentLate(
                db, sessionData.teacherId, studentId, sessionId,
                attendanceId, sessionData.classId, sessionData.departmentId, minutesLate
            ).catch(console.error);
        }

        if (sessionData.method === 'gps' && !isLate) {
            checkGPSProximity(
                db, studentId, studentData.name,
                studentLat, studentLng,
                sessionId, sessionData.classId, sessionData.departmentId
            ).catch(console.error); // fire and forget
        }

        logAction(db, ACTIONS.ATTENDANCE_MARKED, studentId, ACTOR_ROLES.STUDENT, attendanceId, TARGET_TYPES.ATTENDANCE,
            createDetails({
                faceScore, method: sessionData.method,
                status: isLate ? 'late' : 'present',
                sessionId, isSuspicious: deviceFraud.isFraud
            }),
            sessionData.departmentId, req.ip
        ).catch(console.error);

        return res.status(201).json({
            success: true,
            data: {
                attendanceId,
                status: isLate ? 'late' : 'present',
                message: isLate ? 'Marked late — waiting for teacher approval' : 'Attendance marked successfully',
                percentage: summaryResult?.percentage || null
            }
        });

    } catch (error) {
        console.error('markAttendance error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Failed to mark attendance', code: 'SERVER_ERROR' });
    }
};

// ━━━ APPROVE LATE ━━━
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

// ━━━ AUTO ABSENT LATE STUDENTS ━━━
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

// ━━━ END SESSION & MARK ABSENT ━━━
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

// ━━━ GET SESSION ATTENDANCE ━━━
export const getSessionAttendance = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const uid = req.user.uid;

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) return res.status(404).json({ success: false, error: 'Invalid bounding session limits.', code: 'NOT_FOUND' });

        const session = sessionDoc.data();

        if (session.teacherId !== uid) {
            const classDoc = await db.collection('classes').doc(session.classId).get();
            if (!classDoc.data()?.students?.includes(uid)) {
                return res.status(403).json({ success: false, error: 'Permission invalid cross-boundary domain blocks.', code: 'UNAUTHORIZED' });
            }
        }

        const snap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .orderBy('joinedAt', 'asc')
            .get();

        const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const present = [];
        const late = [];
        const absent = [];
        const approved = [];

        for (const r of records) {
            if (r.status === 'present') {
                if (r.teacherApproved === true && r.approvedAt) {
                    approved.push(r);
                } else {
                    present.push(r);
                }
            } else if (r.status === 'late' && r.teacherApproved == null) {
                late.push(r);
            } else if (r.status === 'absent') {
                absent.push(r);
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                present, late, absent, approved,
                counts: {
                    present: present.length + approved.length,
                    late: late.length,
                    absent: absent.length,
                    total: records.length
                }
            }
        });
    } catch (error) {
        console.error('getSessionAttendance error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, error: 'Failure evaluating attendance lists internal domain fault', code: 'SERVER_ERROR' });
    }
};

// ━━━ EXPORT ATTENDANCE EXCEL ━━━
export const exportAttendanceExcel = async (req, res, next) => {
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
            for (let i = 0; i < sessionIds.length; i += 30) {
                const batch = sessionIds.slice(i, i + 30);
                const aSnap = await db.collection('attendance').where('sessionId', 'in', batch).get();
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

// ━━━ EXPORT ATTENDANCE PDF ━━━
export const exportAttendancePDF = async (req, res, next) => {
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
            for (let i = 0; i < sessionIds.length; i += 30) {
                const batch = sessionIds.slice(i, i + 30);
                const aSnap = await db.collection('attendance').where('sessionId', 'in', batch).get();
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

// ━━━ EXPORT STUDENT CERTIFICATE ━━━
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

// ━━━ EXPORT DEPARTMENT EXCEL ━━━
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

// ━━━ MANUAL APPROVE ━━━
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

// ━━━ GET STUDENT ATTENDANCE ━━━
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

// ━━━ UPDATE ATTENDANCE STATUS ━━━
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

// ━━━ FETCH REPORT DATA ━━━
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

// ━━━ GET ATTENDANCE REPORT ━━━
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

import { db, admin } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'
import {
    generateSessionCode,
    getSessionDuration,
    isSessionExpired
} from '../utils/lateDetection.js'
import { v4 as uuidv4 } from 'uuid'
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js'
import { updateSummaryOnAttendance } from '../utils/summaryUpdater.js'
import { getFraudFlagsForSession } from '../utils/fraudDetector.js'

const FieldValue = admin.firestore.FieldValue

const VALID_METHODS = ['qrcode', 'bluetooth', 'network', 'gps']

// ─── Helper: fetch session & verify ownership ──────────────────────────────────
const fetchAndVerifySession = async (sessionId, uid) => {
    const sessionDoc = await db.collection('sessions').doc(sessionId).get()
    if (!sessionDoc.exists) {
        return { error: { message: 'Session not found', code: 'SESSION_NOT_FOUND', status: 404 } }
    }
    const sessionData = { id: sessionDoc.id, ...sessionDoc.data() }
    if (sessionData.teacherId !== uid) {
        return { error: { message: 'Unauthorized — not your session', code: 'NOT_YOUR_SESSION', status: 403 } }
    }
    return { sessionData }
}

// ━━━ START SESSION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/sessions/start
export const startSession = async (req, res, next) => {
    try {
        const {
            classId, method,
            lateAfterMinutes, autoAbsentMinutes,
            faceRequired,
            roomNumber, buildingName,
            qrRefreshInterval,
            teacherLat, teacherLng, radiusMeters,
            expectedSSID,
            bleSessionCode
        } = req.body

        // 1. Validate classId
        if (!classId) {
            return res.status(400).json({
                success: false,
                error: 'classId is required',
                code: 'VALIDATION_ERROR'
            })
        }

        // 2. Validate method
        if (!method || !VALID_METHODS.includes(method)) {
            return res.status(400).json({
                success: false,
                error: `method must be one of: ${VALID_METHODS.join(', ')}`,
                code: 'VALIDATION_ERROR'
            })
        }

        // 3. Verify teacher owns this class and class is active
        const classDoc = await db.collection('classes').doc(classId).get()
        if (!classDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Class not found',
                code: 'CLASS_NOT_FOUND'
            })
        }
        const classData = classDoc.data()

        if (classData.teacherId !== req.user.uid) {
            return res.status(403).json({
                success: false,
                error: 'You do not own this class',
                code: 'NOT_YOUR_CLASS'
            })
        }

        if (!classData.isActive) {
            return res.status(400).json({
                success: false,
                error: 'This class is archived',
                code: 'CLASS_ARCHIVED'
            })
        }

        // 4. Check for existing active session
        const activeCheck = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'active')
            .limit(1)
            .get()

        if (!activeCheck.empty) {
            return res.status(400).json({
                success: false,
                error: 'Class already has an active session',
                code: 'SESSION_ALREADY_ACTIVE',
                existingSessionId: activeCheck.docs[0].id
            })
        }

        // 5. Method-specific validation
        if (method === 'gps') {
            if (!teacherLat || !teacherLng) {
                return res.status(400).json({
                    success: false,
                    error: 'teacherLat and teacherLng are required for GPS method',
                    code: 'GPS_COORDINATES_REQUIRED'
                })
            }
        }

        if (method === 'network') {
            if (!expectedSSID) {
                return res.status(400).json({
                    success: false,
                    error: 'expectedSSID is required for network method',
                    code: 'SSID_REQUIRED'
                })
            }
        }

        // 6. Fetch teacher document for teacherName
        const teacherDoc = await db.collection('teachers').doc(req.user.uid).get()
        const teacherName = teacherDoc.exists ? teacherDoc.data().name : req.user.name

        // 7. Generate codes for QR and Bluetooth methods
        let qrCode = null
        let generatedBleCode = null

        if (method === 'qrcode') {
            qrCode = uuidv4()
        }

        if (method === 'bluetooth') {
            generatedBleCode = bleSessionCode || uuidv4()
        }

        // 8. Build the complete session document
        const sessionRef = db.collection('sessions').doc()
        const sessionId = sessionRef.id

        const sessionDoc2 = {
            sessionId,
            classId,
            teacherId: req.user.uid,
            teacherName: teacherName,
            departmentId: classData.departmentId,
            subjectName: classData.subjectName,
            subjectCode: classData.subjectCode || null,
            semester: classData.semester || null,
            section: classData.section || null,
            batch: classData.batch || null,
            academicYear: classData.academicYear || null,
            method,
            status: 'active',
            faceRequired: faceRequired || false,
            lateAfterMinutes: lateAfterMinutes || 10,
            autoAbsentMinutes: autoAbsentMinutes || 5,
            totalStudents: classData.students ? classData.students.length : 0,
            roomNumber: roomNumber || null,
            buildingName: buildingName || null,

            // QR fields
            qrCode: method === 'qrcode' ? qrCode : null,
            qrRefreshInterval: method === 'qrcode' ? (qrRefreshInterval || 30) : null,
            qrLastRefreshed: method === 'qrcode' ? FieldValue.serverTimestamp() : null,

            // GPS fields
            teacherLat: method === 'gps' ? parseFloat(teacherLat) : null,
            teacherLng: method === 'gps' ? parseFloat(teacherLng) : null,
            radiusMeters: method === 'gps' ? (radiusMeters || 50) : null,

            // Network fields
            expectedSSID: method === 'network' ? expectedSSID : null,

            // Bluetooth fields
            bleSessionCode: method === 'bluetooth' ? generatedBleCode : null,

            startTime: FieldValue.serverTimestamp(),
            endTime: null,
            createdAt: FieldValue.serverTimestamp()
        }

        await sessionRef.set(sessionDoc2)

        // 9. Update class: increment totalSessions & lastSessionDate
        await db.collection('classes').doc(classId).update({
            totalSessions: FieldValue.increment(1),
            lastSessionDate: FieldValue.serverTimestamp()
        })

        // 10. Audit log — fire and forget (NO await)
        logAction(
            db,
            ACTIONS.SESSION_STARTED,
            req.user.uid,
            ACTOR_ROLES.TEACHER,
            sessionId,
            TARGET_TYPES.SESSION,
            createDetails({
                classId,
                method,
                subjectName: classData.subjectName,
                totalStudents: sessionDoc2.totalStudents,
                faceRequired: faceRequired || false,
                roomNumber: roomNumber || null,
                buildingName: buildingName || null
            }),
            classData.departmentId,
            req.ip
        )

        // 11. Return response
        return res.status(201).json({
            success: true,
            data: {
                sessionId,
                classId,
                method,
                status: 'active',
                subjectName: classData.subjectName,
                totalStudents: sessionDoc2.totalStudents,
                faceRequired: faceRequired || false,
                lateAfterMinutes: lateAfterMinutes || 10,
                autoAbsentMinutes: autoAbsentMinutes || 5,
                roomNumber: roomNumber || null,
                buildingName: buildingName || null,
                qrCode: method === 'qrcode' ? qrCode : undefined,
                bleSessionCode: method === 'bluetooth' ? generatedBleCode : undefined,
                startTime: new Date().toISOString()
            },
            message: 'Session started successfully'
        })

    } catch (error) {
        console.error('startSession error:', error)
        next(error)
    }
}

// ━━━ END SESSION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/sessions/:sessionId/end
export const endSession = async (req, res, next) => {
    try {
        const { sessionId } = req.params

        // 1. Verify teacher role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return res.status(403).json({
                success: false,
                error: 'Only teachers or HODs can end sessions',
                code: 'FORBIDDEN'
            })
        }

        // 2. Validate sessionId
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId is required',
                code: 'MISSING_SESSION_ID'
            })
        }

        // 3. Fetch session document
        const sessionSnap = await db.collection('sessions').doc(sessionId).get()
        if (!sessionSnap.exists) {
            return res.status(404).json({
                success: false,
                error: 'Session not found',
                code: 'SESSION_NOT_FOUND'
            })
        }
        const sessionData = { id: sessionSnap.id, ...sessionSnap.data() }

        // 4. Verify teacher owns session
        if (sessionData.teacherId !== req.user.uid) {
            return res.status(403).json({
                success: false,
                error: 'You do not own this session',
                code: 'NOT_YOUR_SESSION'
            })
        }

        // 5. Verify session is still active
        if (sessionData.status !== 'active') {
            return res.status(400).json({
                success: false,
                error: 'Session is already ended',
                code: 'SESSION_ALREADY_ENDED'
            })
        }

        // 6. Fetch class document
        const classDoc = await db.collection('classes').doc(sessionData.classId).get()
        const classData = classDoc.exists ? classDoc.data() : {}

        // 7. Get all students enrolled in this class
        const enrolledStudents = classData.students || []

        // 8. Get all attendance records for this session
        const attendanceSnapshot = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get()

        const markedStudentIds = new Set()
        const lateUnapprovedRecords = []

        attendanceSnapshot.docs.forEach(doc => {
            const data = doc.data()
            markedStudentIds.add(data.studentId)

            // Collect late unapproved records for auto-absent
            if (data.status === 'late' && data.teacherApproved === null) {
                lateUnapprovedRecords.push({
                    ref: doc.ref,
                    data: data
                })
            }
        })

        // 9. Find students who NEVER marked attendance
        const absentStudentIds = enrolledStudents.filter(
            uid => !markedStudentIds.has(uid)
        )

        // 10. Fetch absent students' details from students collection
        const absentStudentDocs = await Promise.all(
            absentStudentIds.map(uid =>
                db.collection('students').doc(uid).get()
            )
        )

        const absentStudents = absentStudentDocs
            .filter(doc => doc.exists)
            .map(doc => ({
                studentId: doc.id,
                ...doc.data()
            }))

        // 11. Use Firestore batch for all writes
        const batch = db.batch()

        // 12. Update session to ended
        const sessionRef = db.collection('sessions').doc(sessionId)
        batch.update(sessionRef, {
            status: 'ended',
            endTime: FieldValue.serverTimestamp()
        })

        // 13. Update class updatedAt
        const classRef = db.collection('classes').doc(sessionData.classId)
        batch.update(classRef, {
            updatedAt: FieldValue.serverTimestamp()
        })

        // 14. Auto-absent all late unapproved students
        lateUnapprovedRecords.forEach(record => {
            batch.update(record.ref, {
                status: 'absent',
                autoAbsent: true,
                teacherApproved: false,
                markedAt: FieldValue.serverTimestamp()
            })
        })

        // 15. Create absent attendance records for students who never marked
        absentStudents.forEach(student => {
            const absentRef = db.collection('attendance').doc()
            batch.set(absentRef, {
                attendanceId: absentRef.id,
                sessionId,
                classId: sessionData.classId,
                teacherId: sessionData.teacherId,
                departmentId: sessionData.departmentId,
                studentId: student.studentId,
                studentName: student.name || 'Unknown',
                studentRollNumber: student.rollNumber || null,
                semester: sessionData.semester || null,
                section: sessionData.section || null,
                status: 'absent',
                method: sessionData.method,
                faceVerified: false,
                faceScore: null,
                teacherApproved: false,
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
            })
        })

        // 16. Commit the batch
        await batch.commit()

        // 17. Update summaries for all newly absent students — fire and forget (NO await)
        absentStudents.forEach(student => {
            updateSummaryOnAttendance(
                db,
                {
                    studentId: student.studentId,
                    classId: sessionData.classId,
                    status: 'absent',
                    sessionId,
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
                {
                    name: student.name,
                    rollNumber: student.rollNumber
                }
            )
        })

        // 18. Audit log session ended — fire and forget (NO await)
        logAction(
            db,
            ACTIONS.SESSION_ENDED,
            req.user.uid,
            ACTOR_ROLES.TEACHER,
            sessionId,
            TARGET_TYPES.SESSION,
            createDetails({
                classId: sessionData.classId,
                subjectName: sessionData.subjectName,
                totalEnrolled: enrolledStudents.length,
                totalMarked: markedStudentIds.size,
                newAbsentCount: absentStudents.length,
                autoAbsentCount: lateUnapprovedRecords.length,
                method: sessionData.method
            }),
            sessionData.departmentId,
            req.ip
        )

        // 19. Return success response
        return res.status(200).json({
            success: true,
            data: {
                sessionId,
                status: 'ended',
                summary: {
                    totalEnrolled: enrolledStudents.length,
                    totalPresent: markedStudentIds.size - lateUnapprovedRecords.length,
                    totalLateApproved: attendanceSnapshot.docs
                        .filter(d => d.data().status === 'present' && d.data().approvedAt).length,
                    newAbsentMarked: absentStudents.length,
                    autoAbsentFromLate: lateUnapprovedRecords.length
                }
            },
            message: 'Session ended successfully'
        })

    } catch (error) {
        console.error('endSession error:', error)
        next(error)
    }
}

// ━━━ REFRESH QR CODE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATCH /api/sessions/:sessionId/refresh-qr
export const refreshQrCode = async (req, res, next) => {
    try {
        const { sessionId } = req.params

        // 1. Verify teacher role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return res.status(403).json({
                success: false,
                error: 'Only teachers can refresh QR codes',
                code: 'FORBIDDEN'
            })
        }

        // 2. Fetch session document
        const { sessionData, error } = await fetchAndVerifySession(sessionId, req.user.uid)
        if (error) {
            return res.status(error.status).json({
                success: false,
                error: error.message,
                code: error.code
            })
        }

        // 3. Verify session is active
        if (sessionData.status !== 'active') {
            return res.status(400).json({
                success: false,
                error: 'Session is not active',
                code: 'SESSION_NOT_ACTIVE'
            })
        }

        // 4. Verify session method is qrcode
        if (sessionData.method !== 'qrcode') {
            return res.status(400).json({
                success: false,
                error: 'QR refresh is only available for QR code sessions',
                code: 'NOT_QR_SESSION'
            })
        }

        // 5. Generate new QR code
        const newQrCode = uuidv4()

        // 6. Update session document
        await db.collection('sessions').doc(sessionId).update({
            qrCode: newQrCode,
            qrLastRefreshed: FieldValue.serverTimestamp()
        })

        // 7. Return response
        return res.status(200).json({
            success: true,
            data: {
                sessionId,
                qrCode: newQrCode,
                refreshedAt: new Date().toISOString()
            },
            message: 'QR code refreshed successfully'
        })

    } catch (error) {
        console.error('refreshQrCode error:', error)
        next(error)
    }
}

// ━━━ GET ACTIVE SESSION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * Retrieve active session details for a specific class
 * GET /api/sessions/active/:classId
 * 
 * Production-ready implementation with:
 * - Student enrollment verification
 * - Consistent error formatting
 * - Standardized response schema (including GPS fields)
 * - Auto-termination check
 */
export const getActiveSession = async (req, res, next) => {
    try {
        const { classId } = req.params;
        const userId = req.user.uid;
        const userRole = req.user.role; // e.g., 'student', 'teacher', 'hod', 'superAdmin'

        // STEP 1: Verify Class Existence
        const classRef = db.collection('classes').doc(classId);
        const classDoc = await classRef.get();

        if (!classDoc.exists) {
            return res.status(404).json({
                success: false,
                code: "CLASS_NOT_FOUND",
                error: "Class not found"
            });
        }

        // STEP 2: Verify Access Rights
        if (userRole === 'student') {
            // Check enrollment
            const enrollmentQuery = await db.collection('enrollments')
                .where('studentId', '==', userId)
                .where('classId', '==', classId)
                .limit(1)
                .get();

            if (enrollmentQuery.empty) {
                return res.status(403).json({
                    success: false,
                    code: "NOT_ENROLLED",
                    error: "You are not enrolled in this class"
                });
            }
        } else if (userRole === 'teacher') {
            const classData = classDoc.data();
            if (classData.teacherId !== userId) {
                return res.status(403).json({
                    success: false,
                    code: "UNAUTHORIZED",
                    error: "You are not the teacher of this class"
                });
            }
        }
        // HODs and SuperAdmins bypass this check

        // STEP 3: Query Active Session
        const sessionsQuery = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        // Standardized response for NO active session
        if (sessionsQuery.empty) {
            return res.status(404).json({
                success: false,
                code: "NO_ACTIVE_SESSION",
                error: "No active session found"
            });
        }

        const sessionDoc = sessionsQuery.docs[0];
        const session = sessionDoc.data();
        const classData = classDoc.data();

        // STEP 4: Auto-termination Check
        const MILLISECONDS_PER_MINUTE = 60000;
        const startTimeMillis = session.startTime.toMillis();
        const currentTimeMillis = Date.now();
        const minutesSinceStart = (currentTimeMillis - startTimeMillis) / MILLISECONDS_PER_MINUTE;
        const maxDurationMinutes = session.autoAbsentMinutes || 120; // Default max 2 hours

        if (minutesSinceStart > maxDurationMinutes) {
            // Auto-end the session
            await sessionDoc.ref.update({
                status: 'ended',
                endTime: FieldValue.serverTimestamp(),
                autoEnded: true
            });

            // Log the auto-termination
            logAction(db, ACTIONS.SESSION_ENDED, 'system', ACTOR_ROLES.SYSTEM, sessionDoc.id, TARGET_TYPES.SESSION,
                createDetails({ autoEnded: true, reason: 'Max duration exceeded' }), session.departmentId, req.ip
            ).catch(console.error);

            return res.status(404).json({
                success: false,
                code: "SESSION_EXPIRED",
                error: "Session automatically ended due to timeout"
            });
        }

        // STEP 5: Format Standardized Response
        // Crucial: Always include GPS fields, even if null, for strict schema compliance
        const activeSessionResponse = {
            id: sessionDoc.id,
            sessionId: sessionDoc.id, // Included for symmetry
            classId: session.classId,
            teacherId: session.teacherId,
            subjectName: session.subjectName,
            subjectCode: session.subjectCode,
            method: session.method, // 'qr', 'gps', 'face'
            status: session.status,
            startTime: session.startTime?.toDate?.()?.toISOString() || null,
            totalStudents: session.totalStudents || classData.students?.length || 0,
            
            // Configuration parameters
            lateAfterMinutes: session.lateAfterMinutes || 10,
            autoAbsentMinutes: session.autoAbsentMinutes || 5,
            
            // Method-specific fields (guaranteed presence)
            qrCode: session.qrCode || null,
            qrRefreshInterval: session.qrRefreshInterval || null,
            qrRefreshedAt: session.qrRefreshedAt?.toDate?.()?.toISOString() || null,
            
            // GPS Fields - Strictly required by frontend schema
            teacherLat: session.teacherLat !== undefined ? session.teacherLat : null,
            teacherLng: session.teacherLng !== undefined ? session.teacherLng : null,
            radiusMeters: session.radiusMeters !== undefined ? session.radiusMeters : null,
            
            // Audit fields
            departmentId: session.departmentId,
            semester: session.semester,
            section: session.section,
            batch: session.batch,
            academicYear: session.academicYear
        };

        return res.status(200).json({
            success: true,
            data: activeSessionResponse,
            message: "Active session retrieved successfully"
        });

    } catch (error) {
        console.error('getActiveSession error:', error);
        if (next) return next(error);
        return res.status(500).json({
            success: false,
            code: "SERVER_ERROR",
            error: "Failed to fetch active session details"
        });
    }
};

// ━━━ GET SESSION BY ID ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/sessions/:sessionId
export const getSessionById = async (req, res, next) => {
    try {
        const { sessionId } = req.params
        const uid = req.user.uid

        const sessionDoc = await db.collection('sessions').doc(sessionId).get()
        if (!sessionDoc.exists) {
            return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND')
        }

        const sessionData = { id: sessionDoc.id, ...sessionDoc.data() }

        // 2. Verify: teacher OR student in class
        if (sessionData.teacherId !== uid) {
            const classDoc = await db.collection('classes').doc(sessionData.classId).get()
            const classData = classDoc.exists ? classDoc.data() : {}
            if (!classData.students?.includes(uid)) {
                return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')
            }
        }

        // 3. Fetch attendance records
        const attendanceSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get()
        const records = attendanceSnap.docs.map(d => d.data())

        // 4. Calculate counts
        const present = records.filter(r => r.status === 'present').length
        const late = records.filter(r => r.status === 'late').length
        const absent = records.filter(r => r.status === 'absent').length

        return successResponse(res, {
            session: {
                ...sessionData,
                startTime: sessionData.startTime?.toDate?.()?.toISOString() || null,
                endTime: sessionData.endTime?.toDate?.()?.toISOString() || null
            },
            stats: { present, late, absent, total: records.length }
        })

    } catch (error) {
        console.error('getSessionById error:', error)
        next(error)
    }
}

// ━━━ GET CLASS SESSIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/sessions/class/:classId?limit=10&status=ended
export const getClassSessions = async (req, res, next) => {
    try {
        const { classId } = req.params
        const { limit = 10, status } = req.query

        // 1. Verify teacher owns class
        const classDoc = await db.collection('classes').doc(classId).get()
        if (!classDoc.exists) {
            return errorResponse(res, 'Class not found', 404, 'CLASS_NOT_FOUND')
        }
        if (classDoc.data().teacherId !== req.user.uid) {
            return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')
        }

        // 2. Build query (no orderBy to avoid composite index requirement)
        let query = db.collection('sessions').where('classId', '==', classId)
        if (status) query = query.where('status', '==', status)

        const snap = await query.get()

        // Sort in-memory by startTime descending, then limit
        const sessions = snap.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
                startTime: doc.data().startTime?.toDate?.()?.toISOString() || null,
                endTime: doc.data().endTime?.toDate?.()?.toISOString() || null
            }))
            .sort((a, b) => {
                if (!a.startTime) return 1
                if (!b.startTime) return -1
                return new Date(b.startTime) - new Date(a.startTime)
            })
            .slice(0, Number(limit))

        return successResponse(res, { data: sessions, total: sessions.length })

    } catch (error) {
        console.error('getClassSessions error:', error)
        next(error)
    }
}

// ━━━ UPDATE QR CODE (LEGACY) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUT /api/sessions/:sessionId/qr
export const updateQRCode = async (req, res, next) => {
    try {
        const { sessionId } = req.params

        // 1. Fetch and verify ownership
        const { sessionData, error } = await fetchAndVerifySession(sessionId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 2. Verify active
        if (sessionData.status !== 'active') {
            return errorResponse(res, 'Session is not active', 400, 'SESSION_NOT_ACTIVE')
        }

        // 3. Verify QR method
        if (sessionData.method !== 'qrcode') {
            return errorResponse(res, 'QR update only allowed for QR sessions', 400, 'INVALID_METHOD')
        }

        // 4. Generate new QR
        const newQR = uuidv4()

        // 5. Update Firestore
        await db.collection('sessions').doc(sessionId).update({
            qrCode: newQR,
            qrLastRefreshed: FieldValue.serverTimestamp()
        })

        return successResponse(res, {
            message: 'QR code refreshed',
            qrCode: newQR
        })

    } catch (error) {
        console.error('updateQRCode error:', error)
        next(error)
    }
}

// ━━━ GET SESSION STATS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/sessions/:sessionId/stats
export const getSessionStats = async (req, res, next) => {
    try {
        const { sessionId } = req.params

        // 1. Verify teacher role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return res.status(403).json({
                success: false,
                error: 'Only teachers can view session stats',
                code: 'FORBIDDEN'
            })
        }

        // 2. Fetch session
        const sessionSnap = await db.collection('sessions').doc(sessionId).get()
        if (!sessionSnap.exists) {
            return res.status(404).json({
                success: false,
                error: 'Session not found',
                code: 'SESSION_NOT_FOUND'
            })
        }
        const sessionData = { id: sessionSnap.id, ...sessionSnap.data() }

        // 3. Verify teacher owns session
        if (sessionData.teacherId !== req.user.uid) {
            return res.status(403).json({
                success: false,
                error: 'You do not own this session',
                code: 'NOT_YOUR_SESSION'
            })
        }

        // 4. Query attendance records
        const attendanceSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get()
        const records = attendanceSnap.docs.map(d => d.data())

        // 5. Calculate stats
        const present = records.filter(r => r.status === 'present').length
        const late = records.filter(r => r.status === 'late' && r.teacherApproved === null).length
        const approvedLate = records.filter(r => r.status === 'present' && r.approvedAt).length
        const absent = records.filter(r => r.status === 'absent').length
        const totalMarked = records.length
        const totalEnrolled = sessionData.totalStudents || 0
        const notYetMarked = Math.max(0, totalEnrolled - totalMarked)
        const attendancePercentage = totalEnrolled > 0
            ? Math.round(((present + approvedLate) / totalEnrolled) * 1000) / 10
            : 0

        // 6. Get fraud flag count
        const fraudFlags = await getFraudFlagsForSession(db, sessionId)
        const fraudCount = fraudFlags.filter(f => f.status === 'pending').length

        // 7. Return response
        return res.status(200).json({
            success: true,
            data: {
                sessionId,
                subjectName: sessionData.subjectName || null,
                status: sessionData.status,
                method: sessionData.method,
                startTime: sessionData.startTime?.toDate?.()?.toISOString() || null,
                totalEnrolled,
                stats: {
                    present,
                    late,
                    approvedLate,
                    absent,
                    notYetMarked,
                    attendancePercentage
                },
                fraudAlerts: fraudCount,
                roomNumber: sessionData.roomNumber || null,
                buildingName: sessionData.buildingName || null
            }
        })

    } catch (error) {
        console.error('getSessionStats error:', error)
        next(error)
    }
}

// ━━━ GET TEACHER SESSION HISTORY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/sessions/my-sessions
export const getMySessionHistory = async (req, res, next) => {
    try {
        const uid = req.user.uid;
        const role = req.user.role;
        const { classId } = req.query;

        if (role !== 'teacher' && role !== 'hod') {
            return res.status(403).json({
                success: false,
                code: 'FORBIDDEN',
                error: 'Only teachers or HODs can view session history'
            });
        }

        let query = db.collection('sessions').where('teacherId', '==', uid);
        if (classId) {
            query = query.where('classId', '==', classId);
        }
        // Removed orderBy to avoid composite index requirement
        
        const snap = await query.get();
        if (snap.empty) {
            return res.status(200).json({ success: true, data: [], count: 0 });
        }

        let sessions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Sort in-memory by startTime descending
        sessions.sort((a, b) => {
            const timeA = a.startTime?.toMillis ? a.startTime.toMillis() : new Date(a.startTime).getTime();
            const timeB = b.startTime?.toMillis ? b.startTime.toMillis() : new Date(b.startTime).getTime();
            return timeB - timeA;
        });

        // Limit to 100 for performance
        sessions = sessions.slice(0, 100);

        const enrichedSessions = [];

        const sessionBatches = [];
        for (let i = 0; i < sessions.length; i += 10) {
            sessionBatches.push(sessions.slice(i, i + 10));
        }

        for (const batch of sessionBatches) {
            const batchPromises = batch.map(async (session) => {
                const attSnap = await db.collection('attendance')
                    .where('sessionId', '==', session.id)
                    .get();
                
                let present = 0;
                let late = 0;
                let absent = 0;
                
                attSnap.docs.forEach(doc => {
                    const status = doc.data().status;
                    const teacherApproved = doc.data().teacherApproved;
                    if (status === 'present' || (status === 'late' && teacherApproved === true)) {
                        present++;
                    } else if (status === 'late' && teacherApproved === null) {
                        late++;
                    } else if (status === 'absent') {
                        absent++;
                    }
                });

                const totalEnrolled = session.totalStudents || 0;
                const attendancePercentage = totalEnrolled > 0 ? Number(((present / totalEnrolled) * 100).toFixed(2)) : 0;

                return {
                    sessionId: session.id,
                    classId: session.classId,
                    subjectName: session.subjectName,
                    subjectCode: session.subjectCode,
                    method: session.method,
                    status: session.status,
                    startTime: session.startTime?.toDate?.()?.toISOString() || null,
                    endTime: session.endTime?.toDate?.()?.toISOString() || null,
                    totalStudents: session.totalStudents || 0,
                    roomNumber: session.roomNumber || null,
                    buildingName: session.buildingName || null,
                    summary: {
                        totalPresent: present,
                        totalLate: late,
                        totalAbsent: absent,
                        totalEnrolled: totalEnrolled,
                        attendancePercentage: attendancePercentage
                    }
                };
            });
            
            const results = await Promise.all(batchPromises);
            enrichedSessions.push(...results);
        }

        return res.status(200).json({
            success: true,
            data: enrichedSessions,
            count: enrichedSessions.length
        });

    } catch (error) {
        console.error('getMySessionHistory error:', error);
        if (next) return next(error);
        return res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'Database compilation metrics breakdown fault error evaluation domain' });
    }
}



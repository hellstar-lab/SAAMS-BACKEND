import { db, admin } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'
import {
    generateSessionCode,
    getSessionDuration,
    isSessionExpired
} from '../utils/lateDetection.js'

const VALID_METHODS = ['qr', 'bluetooth', 'network', 'gps']

// ─── Helper: fetch session & verify ownership ──────────────────────────────────
const fetchAndVerifySession = async (sessionId, uid) => {
    const sessionDoc = await db.collection('sessions').doc(sessionId).get()
    if (!sessionDoc.exists) {
        return { error: { message: 'Session not found', code: 'SESSION_NOT_FOUND', status: 404 } }
    }
    const sessionData = { id: sessionDoc.id, ...sessionDoc.data() }
    if (sessionData.teacherId !== uid) {
        return { error: { message: 'Unauthorized — not your session', code: 'UNAUTHORIZED', status: 403 } }
    }
    return { sessionData }
}

// ─── START SESSION ─────────────────────────────────────────────────────────────
// POST /api/sessions/start
export const startSession = async (req, res) => {
    try {
        const {
            classId, method,
            lateAfterMinutes, autoAbsentMinutes,
            qrRefreshInterval,
            expectedWifi,
            teacherLat, teacherLng, radiusMeters
        } = req.body

        // 1. Validate classId
        if (!classId) {
            return errorResponse(res, 'classId is required', 400, 'VALIDATION_ERROR')
        }

        // 2. Validate method
        if (!method || !VALID_METHODS.includes(method)) {
            return errorResponse(res, `method must be one of: ${VALID_METHODS.join(', ')}`, 400, 'VALIDATION_ERROR')
        }

        // 3. Verify teacher owns this class
        const classDoc = await db.collection('classes').doc(classId).get()
        if (!classDoc.exists) {
            return errorResponse(res, 'Class not found', 404, 'CLASS_NOT_FOUND')
        }
        if (classDoc.data().teacherId !== req.user.uid) {
            return errorResponse(res, 'Unauthorized — not your class', 403, 'UNAUTHORIZED')
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

        // 5. Build session document
        const sessionData = {
            classId,
            teacherId: req.user.uid,
            method,
            status: 'active',
            lateAfterMinutes: Number(lateAfterMinutes) || 10,
            autoAbsentMinutes: Number(autoAbsentMinutes) || 5,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            endTime: null,
            totalPresent: 0,
            totalLate: 0,
            totalAbsent: 0
        }

        // Method-specific fields
        if (method === 'qr') {
            sessionData.qrCode = generateSessionCode()
            sessionData.qrRefreshInterval = Number(qrRefreshInterval) || 30
            sessionData.qrLastUpdated = admin.firestore.FieldValue.serverTimestamp()
        } else if (method === 'gps') {
            if (!teacherLat || !teacherLng) {
                return errorResponse(res, 'GPS method requires teacherLat and teacherLng', 400, 'VALIDATION_ERROR')
            }
            sessionData.teacherLat = Number(teacherLat)
            sessionData.teacherLng = Number(teacherLng)
            sessionData.radiusMeters = Number(radiusMeters) || 30
        } else if (method === 'network') {
            sessionData.expectedWifi = expectedWifi || ''
        }

        // 6. Save to Firestore
        const sessionRef = await db.collection('sessions').add(sessionData)

        // 7. Update class: increment totalSessions & lastSessionDate
        await db.collection('classes').doc(classId).update({
            totalSessions: admin.firestore.FieldValue.increment(1),
            lastSessionDate: admin.firestore.FieldValue.serverTimestamp()
        })

        return successResponse(res, {
            message: 'Session started successfully',
            sessionId: sessionRef.id,
            session: {
                ...sessionData,
                id: sessionRef.id,
                startTime: new Date().toISOString(),
                qrLastUpdated: sessionData.qrLastUpdated ? new Date().toISOString() : undefined
            }
        }, 201)

    } catch (error) {
        console.error('startSession error:', error)
        return errorResponse(res, 'Failed to start session', 500, 'SERVER_ERROR')
    }
}

// ─── END SESSION ───────────────────────────────────────────────────────────────
// POST /api/sessions/:sessionId/end
export const endSession = async (req, res) => {
    try {
        const { sessionId } = req.params

        // 1 & 2. Fetch and verify teacher ownership
        const { sessionData, error } = await fetchAndVerifySession(sessionId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 3. Verify session is active
        if (sessionData.status !== 'active') {
            return errorResponse(res, 'Session is not active', 400, 'SESSION_NOT_ACTIVE')
        }

        // 4. Fetch class for student roster
        const classDoc = await db.collection('classes').doc(sessionData.classId).get()
        const classData = classDoc.exists ? classDoc.data() : {}

        // 5. Build full student list (registered + pending who have a studentId uid)
        const registeredStudents = classData.students || []
        const pendingUIDs = (classData.pendingStudents || [])
            .map(p => p.uid)
            .filter(Boolean)
        const fullRoster = [...new Set([...registeredStudents, ...pendingUIDs])]

        // 6. Fetch existing attendance records
        const attendanceSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get()
        const attendanceRecords = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        // 7. Find absent students (in roster but no attendance record)
        const markedStudentIds = new Set(attendanceRecords.map(r => r.studentId))
        const absentStudentIds = fullRoster.filter(uid => !markedStudentIds.has(uid))

        // 8. Batch-write absent records
        const now = admin.firestore.FieldValue.serverTimestamp()
        const batch = db.batch()
        for (const uid of absentStudentIds) {
            const absentRef = db.collection('attendance').doc()
            batch.set(absentRef, {
                sessionId,
                classId: sessionData.classId,
                studentId: uid,
                status: 'absent',
                method: sessionData.method,
                faceVerified: false,
                teacherApproved: false,
                joinedAt: null,
                markedAt: now
            })
        }
        if (absentStudentIds.length > 0) {
            await batch.commit()
        }

        // 9. Calculate final stats
        const presentCount = attendanceRecords.filter(r => r.status === 'present').length
        const lateCount = attendanceRecords.filter(r => r.status === 'late').length
        const existingAbsent = attendanceRecords.filter(r => r.status === 'absent').length
        const absentCount = absentStudentIds.length + existingAbsent

        // 10. Update session document
        await db.collection('sessions').doc(sessionId).update({
            status: 'ended',
            endTime: now,
            totalPresent: presentCount,
            totalLate: lateCount,
            totalAbsent: absentCount
        })

        // 11. Return summary with duration
        const duration = getSessionDuration(sessionData.startTime, new Date())

        return successResponse(res, {
            message: 'Session ended successfully',
            summary: {
                totalPresent: presentCount,
                totalLate: lateCount,
                totalAbsent: absentCount,
                duration
            }
        })

    } catch (error) {
        console.error('endSession error:', error)
        return errorResponse(res, 'Failed to end session', 500, 'SERVER_ERROR')
    }
}

// ─── GET ACTIVE SESSION ────────────────────────────────────────────────────────
// GET /api/sessions/active/:classId
export const getActiveSession = async (req, res) => {
    try {
        const { classId } = req.params

        // 1. Query for active session
        const snap = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'active')
            .limit(1)
            .get()

        // 2. None found
        if (snap.empty) {
            return successResponse(res, { activeSession: null })
        }

        const sessionDoc = snap.docs[0]
        const sessionData = { id: sessionDoc.id, ...sessionDoc.data() }

        // 4. Auto-end if expired (>3 hours)
        if (isSessionExpired(sessionData.startTime, 180)) {
            await db.collection('sessions').doc(sessionDoc.id).update({
                status: 'ended',
                endTime: admin.firestore.FieldValue.serverTimestamp()
            })
            return successResponse(res, { activeSession: null, message: 'Session auto-ended due to timeout' })
        }

        return successResponse(res, {
            activeSession: {
                ...sessionData,
                startTime: sessionData.startTime?.toDate?.()?.toISOString() || null
            }
        })

    } catch (error) {
        console.error('getActiveSession error:', error)
        return errorResponse(res, 'Failed to get active session', 500, 'SERVER_ERROR')
    }
}

// ─── GET SESSION BY ID ─────────────────────────────────────────────────────────
// GET /api/sessions/:sessionId
export const getSessionById = async (req, res) => {
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
        return errorResponse(res, 'Failed to fetch session', 500, 'SERVER_ERROR')
    }
}

// ─── GET CLASS SESSIONS ────────────────────────────────────────────────────────
// GET /api/sessions/class/:classId?limit=10&status=ended
export const getClassSessions = async (req, res) => {
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

        return successResponse(res, { sessions, total: sessions.length })

    } catch (error) {
        console.error('getClassSessions error:', error)
        return errorResponse(res, 'Failed to fetch sessions', 500, 'SERVER_ERROR')
    }
}

// ─── UPDATE QR CODE ────────────────────────────────────────────────────────────
// PUT /api/sessions/:sessionId/qr
export const updateQRCode = async (req, res) => {
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
        if (sessionData.method !== 'qr') {
            return errorResponse(res, 'QR update only allowed for QR sessions', 400, 'INVALID_METHOD')
        }

        // 4. Generate new QR
        const newQR = generateSessionCode()

        // 5. Update Firestore
        await db.collection('sessions').doc(sessionId).update({
            qrCode: newQR,
            qrLastUpdated: admin.firestore.FieldValue.serverTimestamp()
        })

        return successResponse(res, {
            message: 'QR code refreshed',
            qrCode: newQR
        })

    } catch (error) {
        console.error('updateQRCode error:', error)
        return errorResponse(res, 'Failed to update QR code', 500, 'SERVER_ERROR')
    }
}

// ─── GET SESSION STATS ─────────────────────────────────────────────────────────
// GET /api/sessions/:sessionId/stats
export const getSessionStats = async (req, res) => {
    try {
        const { sessionId } = req.params

        // 1. Fetch session
        const sessionDoc = await db.collection('sessions').doc(sessionId).get()
        if (!sessionDoc.exists) {
            return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND')
        }
        const sessionData = { id: sessionDoc.id, ...sessionDoc.data() }

        // 2. Fetch all attendance records for this session
        const attendanceSnap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .get()
        const records = attendanceSnap.docs.map(d => d.data())

        // 3. Calculate stats
        const presentCount = records.filter(r => r.status === 'present').length
        const lateCount = records.filter(r => r.status === 'late').length
        const absentCount = records.filter(r => r.status === 'absent').length
        const faceFailedCount = records.filter(r => r.faceVerified === false && r.status !== 'absent').length
        const manualApprovalCount = records.filter(r => r.teacherApproved === true).length
        const total = records.length
        const attendanceRate = total > 0
            ? Math.round(((presentCount + lateCount) / total) * 100)
            : 0

        const duration = sessionData.startTime && sessionData.endTime
            ? getSessionDuration(sessionData.startTime, sessionData.endTime)
            : null

        return successResponse(res, {
            stats: {
                presentCount,
                lateCount,
                absentCount,
                faceFailedCount,
                manualApprovalCount,
                total,
                attendanceRate,
                duration
            },
            session: {
                id: sessionData.id,
                method: sessionData.method,
                status: sessionData.status,
                startTime: sessionData.startTime?.toDate?.()?.toISOString() || null,
                endTime: sessionData.endTime?.toDate?.()?.toISOString() || null
            }
        })

    } catch (error) {
        console.error('getSessionStats error:', error)
        return errorResponse(res, 'Failed to fetch session stats', 500, 'SERVER_ERROR')
    }
}

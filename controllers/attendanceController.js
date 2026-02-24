import { db, admin } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'
import { isStudentLate } from '../utils/lateDetection.js'
import { generateAttendanceExcel } from '../utils/excelGenerator.js'

// ─── Haversine Distance Formula ───────────────────────────────────────────────
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000 // Earth radius in metres
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Shared: parse date range from query ──────────────────────────────────────
const parseDateRange = (fromDate, toDate) => {
    const from = fromDate ? new Date(fromDate) : new Date('2000-01-01')
    const to = toDate ? new Date(toDate) : new Date()
    to.setHours(23, 59, 59, 999)
    return { from, to }
}

// ─── Shared: build per-student summary from attendance records ────────────────
const buildStudentSummary = (records, totalSessions) => {
    const map = {}
    for (const r of records) {
        if (!map[r.studentId]) {
            map[r.studentId] = { present: 0, late: 0, absent: 0, faceFailed: 0, manualApproved: 0 }
        }
        const s = map[r.studentId]
        if (r.status === 'present') s.present++
        else if (r.status === 'late') s.late++
        else if (r.status === 'absent') s.absent++
        else if (r.status === 'face_failed') s.faceFailed++
        if (r.manualApproval === true) s.manualApproved++
    }
    return map
}

// ─── MARK ATTENDANCE ──────────────────────────────────────────────────────────
// POST /api/attendance/mark
export const markAttendance = async (req, res) => {
    try {
        const { sessionId, method, faceVerified, qrCode, studentLat, studentLng, studentWifi } = req.body
        const studentId = req.user.uid

        // 1. Validate sessionId
        if (!sessionId) return errorResponse(res, 'sessionId is required', 400, 'VALIDATION_ERROR')

        // 2. Fetch session
        const sessionDoc = await db.collection('sessions').doc(sessionId).get()
        if (!sessionDoc.exists) return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND')
        const session = sessionDoc.data()

        // 3. Verify session is active
        if (session.status !== 'active') return errorResponse(res, 'Session has ended', 400, 'SESSION_ENDED')

        // 5. Check already marked
        const existing = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('studentId', '==', studentId)
            .limit(1)
            .get()

        if (!existing.empty) {
            const existingStatus = existing.docs[0].data().status
            if (existingStatus !== 'face_failed') {
                return errorResponse(res, 'Attendance already marked', 400, 'ALREADY_MARKED')
            }
            // If face_failed and retrying — allow re-mark below
        }

        // 6. Method-specific validation
        if (method === 'qr') {
            if (!qrCode || qrCode !== session.qrCode) {
                return errorResponse(res, 'Invalid or expired QR code', 400, 'INVALID_QR')
            }
        } else if (method === 'gps') {
            if (studentLat === undefined || studentLng === undefined) {
                return errorResponse(res, 'GPS coordinates required', 400, 'VALIDATION_ERROR')
            }
            const distance = calculateDistance(
                Number(studentLat), Number(studentLng),
                session.teacherLat, session.teacherLng
            )
            if (distance > session.radiusMeters) {
                return res.status(400).json({
                    success: false,
                    error: 'You are not in the classroom',
                    code: 'OUT_OF_RANGE',
                    distance: Math.round(distance),
                    allowed: session.radiusMeters
                })
            }
        } else if (method === 'network') {
            if (studentWifi !== session.expectedWifi) {
                return errorResponse(res, 'You are not on the correct network', 400, 'WRONG_NETWORK')
            }
        }

        // 7. Face failed — save as face_failed and await teacher approval
        if (faceVerified === false) {
            let docRef
            if (!existing.empty) {
                // Update existing face_failed record
                docRef = existing.docs[0].ref
                await docRef.update({ markedAt: admin.firestore.FieldValue.serverTimestamp() })
            } else {
                docRef = await db.collection('attendance').add({
                    sessionId,
                    classId: session.classId,
                    studentId,
                    status: 'face_failed',
                    method: method || session.method,
                    faceVerified: false,
                    teacherApproved: false,
                    manualApproval: false,
                    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                    markedAt: admin.firestore.FieldValue.serverTimestamp()
                })
            }
            return res.status(200).json({
                success: true,
                status: 'face_failed',
                attendanceId: docRef.id,
                message: 'Face not recognized. Waiting for teacher approval.'
            })
        }

        // 8. Determine late
        const late = isStudentLate(session.startTime, new Date(), session.lateAfterMinutes)

        // 9. Create/update attendance record
        const attendanceData = {
            sessionId,
            classId: session.classId,
            studentId,
            status: late ? 'late' : 'present',
            method: method || session.method,
            faceVerified: true,
            teacherApproved: late ? null : true,
            manualApproval: false,
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            markedAt: admin.firestore.FieldValue.serverTimestamp()
        }

        let attendanceId
        if (!existing.empty) {
            // Replace face_failed with real mark
            await existing.docs[0].ref.set(attendanceData)
            attendanceId = existing.docs[0].id
        } else {
            const docRef = await db.collection('attendance').add(attendanceData)
            attendanceId = docRef.id
        }

        // 10. Return result
        return successResponse(res, {
            status: late ? 'late' : 'present',
            attendanceId,
            isLate: late,
            message: late
                ? 'Marked late. Waiting for teacher approval.'
                : 'Attendance marked successfully!'
        })

    } catch (error) {
        console.error('markAttendance error:', error)
        return errorResponse(res, 'Failed to mark attendance', 500, 'SERVER_ERROR')
    }
}

// ─── MANUAL APPROVE ───────────────────────────────────────────────────────────
// POST /api/attendance/manual-approve
export const manualApprove = async (req, res) => {
    try {
        const { sessionId, studentId, approved, reason } = req.body

        if (!sessionId || !studentId || approved === undefined) {
            return errorResponse(res, 'sessionId, studentId and approved are required', 400, 'VALIDATION_ERROR')
        }

        // 1. Verify teacher (role already set by authMiddleware from teachers collection)
        if (req.user.role !== 'teacher') {
            return errorResponse(res, 'Only teachers can manually approve', 403, 'TEACHER_ONLY')
        }

        // 2 & 3. Fetch session + verify ownership + verify active
        const sessionDoc = await db.collection('sessions').doc(sessionId).get()
        if (!sessionDoc.exists) return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND')
        const session = sessionDoc.data()
        if (session.teacherId !== req.user.uid) return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')
        if (session.status !== 'active') return errorResponse(res, 'Session is not active', 400, 'SESSION_NOT_ACTIVE')

        // 4. Check if attendance record exists
        const existing = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('studentId', '==', studentId)
            .limit(1)
            .get()

        const now = admin.firestore.FieldValue.serverTimestamp()

        if (!existing.empty) {
            // 5. Update existing record
            await existing.docs[0].ref.update({
                status: approved ? 'present' : 'absent',
                teacherApproved: approved,
                manualApproval: approved,
                approvalReason: reason || 'Teacher approval',
                approvedAt: now
            })
        } else {
            // 6. Create new manual record
            await db.collection('attendance').add({
                sessionId,
                classId: session.classId,
                studentId,
                status: approved ? 'present' : 'absent',
                method: 'manual',
                faceVerified: false,
                teacherApproved: approved,
                manualApproval: true,
                approvalReason: reason || 'Manual entry',
                joinedAt: now,
                markedAt: now
            })
        }

        return successResponse(res, {
            status: approved ? 'present' : 'absent',
            message: approved ? 'Student marked present manually' : 'Student marked absent'
        })

    } catch (error) {
        console.error('manualApprove error:', error)
        return errorResponse(res, 'Failed to process approval', 500, 'SERVER_ERROR')
    }
}

// ─── GET SESSION ATTENDANCE ───────────────────────────────────────────────────
// GET /api/attendance/session/:sessionId
export const getSessionAttendance = async (req, res) => {
    try {
        const { sessionId } = req.params
        const uid = req.user.uid

        // 1. Fetch session + verify access
        const sessionDoc = await db.collection('sessions').doc(sessionId).get()
        if (!sessionDoc.exists) return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND')
        const session = sessionDoc.data()

        const isTeacher = session.teacherId === uid
        if (!isTeacher) {
            const classDoc = await db.collection('classes').doc(session.classId).get()
            if (!classDoc.data()?.students?.includes(uid)) {
                return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')
            }
        }

        // 2. Fetch all records
        const snap = await db.collection('attendance').where('sessionId', '==', sessionId).get()
        const records = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // 3. Fetch student profiles in parallel
        const profileCache = {}
        await Promise.all(records.map(async r => {
            if (!profileCache[r.studentId]) {
                const doc = await db.collection('students').doc(r.studentId).get()
                profileCache[r.studentId] = doc.exists ? { name: doc.data().name, studentId: doc.data().studentId, email: doc.data().email } : null
            }
        }))

        const enriched = records.map(r => ({
            ...r,
            joinedAt: r.joinedAt?.toDate?.()?.toISOString() || null,
            markedAt: r.markedAt?.toDate?.()?.toISOString() || null,
            student: profileCache[r.studentId] || null
        }))

        // 4. Group by status
        const grouped = { present: [], late: [], absent: [], face_failed: [] }
        for (const r of enriched) {
            const key = r.status === 'face_failed' ? 'face_failed' : (r.status || 'absent')
            if (grouped[key]) grouped[key].push(r)
        }

        return successResponse(res, {
            attendance: grouped,
            counts: {
                present: grouped.present.length,
                late: grouped.late.length,
                absent: grouped.absent.length,
                face_failed: grouped.face_failed.length,
                total: records.length
            }
        })

    } catch (error) {
        console.error('getSessionAttendance error:', error)
        return errorResponse(res, 'Failed to fetch attendance', 500, 'SERVER_ERROR')
    }
}

// ─── GET STUDENT ATTENDANCE ───────────────────────────────────────────────────
// GET /api/attendance/student/:studentId?classId=X&limit=20
export const getStudentAttendance = async (req, res) => {
    try {
        const { studentId } = req.params
        const { classId, limit = 20 } = req.query
        const uid = req.user.uid

        // 1. Verify requester is the student OR teacher of class
        if (uid !== studentId) {
            if (classId) {
                const classDoc = await db.collection('classes').doc(classId).get()
                if (!classDoc.exists || classDoc.data().teacherId !== uid) {
                    return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')
                }
            } else {
                return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')
            }
        }

        // 2. Build query
        let query = db.collection('attendance').where('studentId', '==', studentId)
        if (classId) query = query.where('classId', '==', classId)
        const snap = await query.get()

        // Sort in-memory by markedAt desc, then limit
        const records = snap.docs
            .map(d => ({
                id: d.id,
                ...d.data(),
                joinedAt: d.data().joinedAt?.toDate?.()?.toISOString() || null,
                markedAt: d.data().markedAt?.toDate?.()?.toISOString() || null
            }))
            .sort((a, b) => {
                if (!a.markedAt) return 1
                if (!b.markedAt) return -1
                return new Date(b.markedAt) - new Date(a.markedAt)
            })
            .slice(0, Number(limit))

        // 3. Enrich each record with session info
        const sessionCache = {}
        const enriched = await Promise.all(records.map(async r => {
            if (r.sessionId && !sessionCache[r.sessionId]) {
                const sDoc = await db.collection('sessions').doc(r.sessionId).get()
                sessionCache[r.sessionId] = sDoc.exists ? { startTime: sDoc.data().startTime?.toDate?.()?.toISOString() || null, method: sDoc.data().method } : null
            }
            return { ...r, session: sessionCache[r.sessionId] || null }
        }))

        // 4. Calculate overall stats from all records (not just paginated)
        const allSnap = await (classId
            ? db.collection('attendance').where('studentId', '==', studentId).where('classId', '==', classId).get()
            : db.collection('attendance').where('studentId', '==', studentId).get())
        const allRecords = allSnap.docs.map(d => d.data())
        const totalClasses = allRecords.length
        const present = allRecords.filter(r => r.status === 'present').length
        const late = allRecords.filter(r => r.status === 'late').length
        const absent = allRecords.filter(r => r.status === 'absent').length
        const percentage = totalClasses > 0 ? Math.round(((present + late) / totalClasses) * 100) : 0

        return successResponse(res, {
            records: enriched,
            stats: { totalClasses, present, late, absent, percentage }
        })

    } catch (error) {
        console.error('getStudentAttendance error:', error)
        return errorResponse(res, 'Failed to fetch student attendance', 500, 'SERVER_ERROR')
    }
}

// ─── UPDATE ATTENDANCE STATUS ─────────────────────────────────────────────────
// PUT /api/attendance/:attendanceId/status
export const updateAttendanceStatus = async (req, res) => {
    try {
        const { attendanceId } = req.params
        const { status, teacherApproved, reason } = req.body
        const VALID_STATUSES = ['present', 'late', 'absent', 'face_failed']

        // 1. Fetch attendance record
        const attDoc = await db.collection('attendance').doc(attendanceId).get()
        if (!attDoc.exists) return errorResponse(res, 'Attendance record not found', 404, 'NOT_FOUND')
        const attData = attDoc.data()

        // 2. Fetch session
        const sessionDoc = await db.collection('sessions').doc(attData.sessionId).get()
        if (!sessionDoc.exists) return errorResponse(res, 'Session not found', 404, 'SESSION_NOT_FOUND')
        const session = sessionDoc.data()

        // 3. Verify teacher of session
        if (session.teacherId !== req.user.uid) return errorResponse(res, 'Unauthorized', 403, 'UNAUTHORIZED')

        // 4. Verify session is active
        if (session.status !== 'active') return errorResponse(res, 'Session is not active', 400, 'SESSION_NOT_ACTIVE')

        // 5. Validate status
        if (!status || !VALID_STATUSES.includes(status)) {
            return errorResponse(res, `status must be one of: ${VALID_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR')
        }

        // 6. Update record
        const updateData = {
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
        if (teacherApproved !== undefined) updateData.teacherApproved = teacherApproved
        if (reason) updateData.approvalReason = reason

        await db.collection('attendance').doc(attendanceId).update(updateData)
        const updated = await db.collection('attendance').doc(attendanceId).get()

        return successResponse(res, {
            message: 'Attendance status updated',
            attendance: { id: updated.id, ...updated.data() }
        })

    } catch (error) {
        console.error('updateAttendanceStatus error:', error)
        return errorResponse(res, 'Failed to update attendance', 500, 'SERVER_ERROR')
    }
}

// ─── Shared data-fetch logic for report & export ──────────────────────────────
const fetchReportData = async (classId, teacherId, fromDate, toDate) => {
    // Verify teacher owns class
    const classDoc = await db.collection('classes').doc(classId).get()
    if (!classDoc.exists) return { error: { message: 'Class not found', code: 'CLASS_NOT_FOUND', status: 404 } }
    if (classDoc.data().teacherId !== teacherId) return { error: { message: 'Unauthorized', code: 'UNAUTHORIZED', status: 403 } }
    const classData = { id: classDoc.id, ...classDoc.data() }

    // Fetch ended sessions in date range (in-memory filter to avoid composite index)
    const sessionsSnap = await db.collection('sessions')
        .where('classId', '==', classId)
        .where('status', '==', 'ended')
        .get()

    const sessions = sessionsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => {
            if (!s.startTime) return true
            const t = s.startTime.toDate ? s.startTime.toDate() : new Date(s.startTime)
            return t >= fromDate && t <= toDate
        })
        .sort((a, b) => {
            const at = a.startTime?.toDate?.() || new Date(a.startTime)
            const bt = b.startTime?.toDate?.() || new Date(b.startTime)
            return bt - at
        })

    if (sessions.length === 0) return { classData, sessions: [], students: [] }

    // Fetch all attendance for those sessions
    const sessionIds = sessions.map(s => s.id)
    // Firestore 'in' query supports max 30 items per query; batch if needed
    let allRecords = []
    for (let i = 0; i < sessionIds.length; i += 30) {
        const batch = sessionIds.slice(i, i + 30)
        const snap = await db.collection('attendance').where('sessionId', 'in', batch).get()
        allRecords.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }

    // Build per-student summary
    const summaryMap = buildStudentSummary(allRecords, sessions.length)

    // Fetch student profiles for each UID found
    const studentUIDs = Object.keys(summaryMap)
    const profiles = {}
    await Promise.all(studentUIDs.map(async uid => {
        const doc = await db.collection('students').doc(uid).get()
        profiles[uid] = doc.exists ? doc.data() : {}
    }))

    const studentSummaries = studentUIDs.map(uid => {
        const s = summaryMap[uid]
        const p = profiles[uid] || {}
        const total = s.present + s.late + s.absent + s.faceFailed
        const percentage = total > 0 ? Math.round(((s.present + s.late) / total) * 100) : 0
        return {
            uid,
            name: p.name || 'Unknown',
            studentId: p.studentId || '',
            email: p.email || '',
            ...s,
            total,
            percentage
        }
    })

    const sessionsSerialized = sessions.map(s => ({
        ...s,
        startTime: s.startTime?.toDate?.()?.toISOString() || null,
        endTime: s.endTime?.toDate?.()?.toISOString() || null
    }))

    return { classData, sessions: sessionsSerialized, students: studentSummaries }
}

// ─── GET ATTENDANCE REPORT ────────────────────────────────────────────────────
// GET /api/attendance/report/:classId?fromDate=X&toDate=X
export const getAttendanceReport = async (req, res) => {
    try {
        const { classId } = req.params
        const { fromDate, toDate } = req.query
        const { from, to } = parseDateRange(fromDate, toDate)

        const result = await fetchReportData(classId, req.user.uid, from, to)
        if (result.error) return errorResponse(res, result.error.message, result.error.status, result.error.code)

        const { sessions, students } = result
        const totalSessions = sessions.length
        const avgAttendance = students.length > 0
            ? Math.round(students.reduce((s, st) => s + st.percentage, 0) / students.length)
            : 0
        const atRiskCount = students.filter(s => s.percentage < 75).length

        return successResponse(res, {
            sessions,
            students,
            stats: { totalSessions, avgAttendance, atRiskCount }
        })

    } catch (error) {
        console.error('getAttendanceReport error:', error)
        return errorResponse(res, 'Failed to generate report', 500, 'SERVER_ERROR')
    }
}

// ─── EXPORT ATTENDANCE REPORT ─────────────────────────────────────────────────
// GET /api/attendance/export/:classId?fromDate=X&toDate=X
export const exportAttendanceReport = async (req, res) => {
    try {
        const { classId } = req.params
        const { fromDate, toDate } = req.query
        const { from, to } = parseDateRange(fromDate, toDate)

        const result = await fetchReportData(classId, req.user.uid, from, to)
        if (result.error) return errorResponse(res, result.error.message, result.error.status, result.error.code)

        const { classData, sessions, students } = result
        const dateRange = `${from.toLocaleDateString('en-IN')} – ${to.toLocaleDateString('en-IN')}`

        const excelBase64 = generateAttendanceExcel({
            className: classData.subjectName,
            subjectCode: classData.subjectCode,
            semester: classData.semester,
            dateRange,
            sessions,
            students
        })

        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename=SAAM_Report_${classId}.xlsx`
        })
        return res.send(Buffer.from(excelBase64, 'base64'))

    } catch (error) {
        console.error('exportAttendanceReport error:', error)
        return errorResponse(res, 'Failed to export report', 500, 'SERVER_ERROR')
    }
}

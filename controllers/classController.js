// CLASS CONTROLLER
// Manages subject classes linking teachers to students.
// Classes belong to departments.
// Classes are never hard deleted — use archive.
// Student enrollment updates both the class students array
// AND the student enrolledClasses array to keep them in sync always.

import { db, admin } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js'
import { FieldValue } from 'firebase-admin/firestore'

// ─── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Returns the current academic year string, e.g. '2024-25'.
 * Academic year starts in July.
 */
const getCurrentAcademicYear = () => {
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    if (month >= 7) {
        return year + '-' + String(year + 1).slice(-2)
    } else {
        return (year - 1) + '-' + String(year).slice(-2)
    }
}

/**
 * Validates that section is one of A, B, C, or ALL (case-insensitive).
 */
const validateSection = (section) => {
    const valid = ['A', 'B', 'C', 'ALL', 'a', 'b', 'c', 'all']
    return valid.includes(section)
}

/**
 * Maps req.user.role to the correct ACTOR_ROLES constant.
 */
const getActorRole = (role) => {
    if (role === 'hod') return ACTOR_ROLES.HOD
    if (role === 'superAdmin') return ACTOR_ROLES.SUPER_ADMIN
    return ACTOR_ROLES.TEACHER
}

/**
 * Fetch a class document and verify the requesting user owns it.
 */
const fetchAndVerifyOwnership = async (classId, uid) => {
    const classDoc = await db.collection('classes').doc(classId).get()
    if (!classDoc.exists) {
        return { error: { message: 'Class not found', code: 'CLASS_NOT_FOUND', status: 404 } }
    }
    const classData = { id: classDoc.id, ...classDoc.data() }
    if (classData.teacherId !== uid) {
        return { error: { message: 'Unauthorized — not your class', code: 'NOT_YOUR_CLASS', status: 403 } }
    }
    return { classData }
}

// ━━━ CREATE CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/classes
export const createClass = async (req, res, next) => {
    try {
        const { subjectName, subjectCode, semester, section, batch, academicYear, minAttendance } = req.body

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers can create classes', 403, 'TEACHER_ONLY')
        }

        // 2. Validate all required fields
        const missingFields = []
        if (!subjectName || subjectName.trim().length < 3) missingFields.push('subjectName (min 3 chars)')
        if (!subjectCode) missingFields.push('subjectCode')
        if (!semester) missingFields.push('semester')
        if (!section) missingFields.push('section')
        if (!batch) missingFields.push('batch')

        if (missingFields.length > 0) {
            return errorResponse(res, `Missing required fields: ${missingFields.join(', ')}`, 400, 'MISSING_FIELDS')
        }

        // 3. Validate semester is 1-8
        const semNum = parseInt(semester)
        if (isNaN(semNum) || semNum < 1 || semNum > 8) {
            return errorResponse(res, 'Semester must be a number between 1 and 8', 400, 'INVALID_SEMESTER')
        }

        // 4. Validate section
        if (!validateSection(section)) {
            return errorResponse(res, 'Section must be A, B, C, or ALL', 400, 'INVALID_SECTION')
        }

        // 5. Fetch teacher document to get department info
        const teacherDoc = await db.collection('teachers').doc(req.user.uid).get()
        const teacherData = teacherDoc.data()

        if (!teacherData || !teacherData.departmentId) {
            return res.status(400).json({
                success: false,
                error: 'You must be assigned to a department before creating classes. Please contact your HOD or admin.',
                code: 'NO_DEPARTMENT_ASSIGNED'
            })
        }

        // 6. Fetch department to get minAttendance
        const deptDoc = await db.collection('departments').doc(teacherData.departmentId).get()
        const deptMinAttendance = deptDoc.exists ? deptDoc.data().minAttendance : 75
        const deptName = deptDoc.exists ? deptDoc.data().name : teacherData.departmentName

        // 7. Check for duplicate class
        const calculatedYear = academicYear || getCurrentAcademicYear()
        const duplicateSnap = await db.collection('classes')
            .where('teacherId', '==', req.user.uid)
            .where('subjectCode', '==', subjectCode.trim().toUpperCase())
            .where('semester', '==', semNum)
            .where('section', '==', section.toUpperCase())
            .where('academicYear', '==', calculatedYear)
            .where('isActive', '==', true)
            .get()

        if (!duplicateSnap.empty) {
            return errorResponse(
                res,
                `You already have an active class for ${subjectCode.trim().toUpperCase()} Sem ${semNum} Section ${section.toUpperCase()}`,
                409,
                'CLASS_ALREADY_EXISTS'
            )
        }

        // 8. Create class document
        const classRef = db.collection('classes').doc()
        const classId = classRef.id

        await classRef.set({
            classId,
            teacherId: req.user.uid,
            teacherName: teacherData.name,
            departmentId: teacherData.departmentId,
            departmentName: deptName || teacherData.departmentName,
            department: deptName || teacherData.departmentName, // for test compatibility
            subjectName: subjectName.trim(),
            subjectCode: subjectCode.trim().toUpperCase(),
            semester: semNum,
            section: section.toUpperCase(),
            batch: batch.trim(),
            academicYear: calculatedYear,
            students: [],
            totalSessions: 0,
            minAttendance: minAttendance || deptMinAttendance || 75,
            isActive: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        })

        // 9. Update department totalClasses (fire and forget — NO await)
        db.collection('departments')
            .doc(teacherData.departmentId)
            .update({
                totalClasses: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp()
            })
            .catch(err => console.error('dept totalClasses update failed:', err))

        // 10. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.CLASS_CREATED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                subjectName: subjectName.trim(),
                subjectCode: subjectCode.trim().toUpperCase(),
                semester: semNum,
                section: section.toUpperCase(),
                batch: batch.trim()
            }),
            teacherData.departmentId,
            req.ip
        )

        // 11. Return 201
        return successResponse(res, {
            data: {
                classId,
                subjectName: subjectName.trim(),
                subjectCode: subjectCode.trim().toUpperCase(),
                semester: semNum,
                section: section.toUpperCase(),
                batch: batch.trim(),
                academicYear: calculatedYear,
                departmentName: deptName || teacherData.departmentName,
                department: deptName || teacherData.departmentName, // for test compatibility
                minAttendance: minAttendance || deptMinAttendance || 75
            },
            message: 'Class created successfully'
        }, 201)

    } catch (error) {
        console.error('createClass error:', error)
        next(error)
    }
}

// ━━━ GET MY CLASSES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/classes
export const getMyClasses = async (req, res, next) => {
    try {
        // Build query dynamically with filters
        let query = db.collection('classes')
            .where('teacherId', '==', req.user.uid)
            .where('isActive', '==', req.query.isActive === 'false' ? false : true)

        if (req.query.semester) {
            query = query.where('semester', '==', parseInt(req.query.semester))
        }
        if (req.query.section) {
            query = query.where('section', '==', req.query.section.toUpperCase())
        }

        query = query.orderBy('createdAt', 'desc')

        const snapshot = await query.get()

        const classes = snapshot.docs.map(doc => {
            const data = doc.data()
            return {
                classId: data.classId || doc.id,
                subjectName: data.subjectName,
                subjectCode: data.subjectCode,
                semester: data.semester,
                section: data.section,
                batch: data.batch,
                academicYear: data.academicYear,
                departmentName: data.departmentName,
                studentCount: (data.students || []).length,
                totalSessions: data.totalSessions || 0,
                minAttendance: data.minAttendance,
                isActive: data.isActive,
                createdAt: data.createdAt
            }
        })

        return successResponse(res, {
            data: classes,
            count: classes.length
        })

    } catch (error) {
        console.error('getMyClasses error:', error)
        next(error)
    }
}

// ━━━ GET CLASS BY ID ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/classes/:classId
export const getClassById = async (req, res, next) => {
    try {
        const { classId } = req.params
        const uid = req.user.uid
        const role = req.user.role

        // 1. Fetch class document
        const classDoc = await db.collection('classes').doc(classId).get()
        if (!classDoc.exists) {
            return errorResponse(res, 'Class not found', 404, 'CLASS_NOT_FOUND')
        }

        const classData = { id: classDoc.id, ...classDoc.data() }

        // 2. Access control based on role
        if (role === 'student') {
            if (!classData.students?.includes(uid)) {
                return errorResponse(res, 'You are not enrolled in this class', 403, 'NOT_ENROLLED')
            }
        } else if (role === 'teacher') {
            if (classData.teacherId !== uid) {
                return errorResponse(res, 'Unauthorized — not your class', 403, 'NOT_YOUR_CLASS')
            }
        } else if (role === 'hod') {
            if (classData.departmentId !== req.user.departmentId) {
                return errorResponse(res, 'Unauthorized — class is not in your department', 403, 'UNAUTHORIZED')
            }
        }
        // superAdmin: allow always — no check needed

        // 3. Fetch active session status
        const activeSession = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'active')
            .limit(1)
            .get()

        return successResponse(res, {
            data: {
                ...classData,
                createdAt: classData.createdAt?.toDate?.()?.toISOString() || null,
                updatedAt: classData.updatedAt?.toDate?.()?.toISOString() || null,
                hasActiveSession: !activeSession.empty,
                activeSessionId: activeSession.empty ? null : activeSession.docs[0].id
            }
        })

    } catch (error) {
        console.error('getClassById error:', error)
        next(error)
    }
}

// ━━━ ADD STUDENTS TO CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/classes/:classId/students
export const addStudentsToClass = async (req, res, next) => {
    try {
        const { classId } = req.params
        const { studentIds } = req.body

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers or HODs can add students', 403, 'TEACHER_ONLY')
        }

        // 2. Validate studentIds is array and not empty
        if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
            return errorResponse(res, 'studentIds must be a non-empty array of UIDs', 400, 'VALIDATION_ERROR')
        }

        // 3. Fetch class document and verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 4. Verify class is active
        if (!classData.isActive) {
            return errorResponse(res, 'Cannot add students to an archived class', 400, 'CLASS_ARCHIVED')
        }

        // 5. Fetch all student documents in parallel
        const studentDocs = await Promise.all(
            studentIds.map(uid => db.collection('students').doc(uid).get())
        )

        // 6. Validate each student
        const validStudents = []
        const skipped = []

        for (let i = 0; i < studentIds.length; i++) {
            const uid = studentIds[i]
            const doc = studentDocs[i]

            if (!doc.exists) {
                skipped.push({ studentId: uid, reason: 'Student not found' })
                continue
            }

            const data = doc.data()

            if (data.isActive === false) {
                skipped.push({ studentId: uid, reason: 'Student account is deactivated' })
                continue
            }

            if (classData.students?.includes(uid)) {
                skipped.push({ studentId: uid, reason: 'Already in class' })
                continue
            }

            validStudents.push({ uid, studentId: data.studentId, name: data.name })
        }

        // 7. Use Firestore batch for all writes
        if (validStudents.length > 0) {
            const batch = db.batch()
            const classRef = db.collection('classes').doc(classId)

            for (const student of validStudents) {
                batch.update(classRef, {
                    students: FieldValue.arrayUnion(student.uid),
                    updatedAt: FieldValue.serverTimestamp()
                })

                const studentRef = db.collection('students').doc(student.uid)
                batch.update(studentRef, {
                    enrolledClasses: FieldValue.arrayUnion(classId),
                    updatedAt: FieldValue.serverTimestamp()
                })
            }

            await batch.commit()
        }

        // 8. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.STUDENT_ADDED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                addedCount: validStudents.length,
                skippedCount: skipped.length,
                studentIds: validStudents.map(s => s.studentId)
            }),
            classData.departmentId,
            req.ip
        )

        // 9. Return
        return successResponse(res, {
            data: {
                added: validStudents.length,
                skipped: skipped.length,
                skippedDetails: skipped,
                totalStudents: (classData.students || []).length + validStudents.length
            },
            message: `${validStudents.length} student(s) added to class`
        })

    } catch (error) {
        console.error('addStudentsToClass error:', error)
        next(error)
    }
}

// ━━━ REMOVE STUDENT FROM CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/classes/:classId/students/:studentId
export const removeStudentFromClass = async (req, res, next) => {
    try {
        const { classId, studentId } = req.params

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers or HODs can remove students', 403, 'TEACHER_ONLY')
        }

        // 2. Fetch class document and verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 3. Verify student is in this class
        if (!classData.students?.includes(studentId)) {
            return errorResponse(res, 'Student is not enrolled in this class', 400, 'STUDENT_NOT_IN_CLASS')
        }

        // 4. Use batch for both updates
        const batch = db.batch()

        const classRef = db.collection('classes').doc(classId)
        batch.update(classRef, {
            students: FieldValue.arrayRemove(studentId),
            updatedAt: FieldValue.serverTimestamp()
        })

        const studentRef = db.collection('students').doc(studentId)
        batch.update(studentRef, {
            enrolledClasses: FieldValue.arrayRemove(classId),
            updatedAt: FieldValue.serverTimestamp()
        })

        await batch.commit()

        // 5. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.STUDENT_REMOVED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                removedStudentId: studentId
            }),
            classData.departmentId,
            req.ip
        )

        // 6. Return
        return successResponse(res, {
            message: 'Student removed from class',
            data: {
                totalStudents: (classData.students || []).length - 1
            }
        })

    } catch (error) {
        console.error('removeStudentFromClass error:', error)
        next(error)
    }
}

// ━━━ ARCHIVE CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATCH /api/classes/:classId/archive
export const archiveClass = async (req, res, next) => {
    try {
        const { classId } = req.params

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers or HODs can archive classes', 403, 'TEACHER_ONLY')
        }

        // 2. Fetch class document and verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 3. Verify class is currently active
        if (!classData.isActive) {
            return errorResponse(res, 'Class is already archived', 400, 'ALREADY_ARCHIVED')
        }

        // 4. Check no active session exists
        const activeSession = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'active')
            .limit(1)
            .get()

        if (!activeSession.empty) {
            return res.status(400).json({
                success: false,
                error: 'Cannot archive class while a session is active. Please end the session first.',
                code: 'ACTIVE_SESSION_EXISTS'
            })
        }

        // 5. Update class
        await db.collection('classes').doc(classId).update({
            isActive: false,
            updatedAt: FieldValue.serverTimestamp()
        })

        // 6. Decrement department totalClasses (fire and forget)
        db.collection('departments')
            .doc(classData.departmentId)
            .update({
                totalClasses: FieldValue.increment(-1),
                updatedAt: FieldValue.serverTimestamp()
            })
            .catch(err => console.error('dept totalClasses decrement failed:', err))

        // 7. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.CLASS_ARCHIVED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                subjectName: classData.subjectName,
                subjectCode: classData.subjectCode,
                semester: classData.semester,
                section: classData.section
            }),
            classData.departmentId,
            req.ip
        )

        // 8. Return
        return successResponse(res, {
            message: 'Class archived successfully',
            data: { classId, isActive: false }
        })

    } catch (error) {
        console.error('archiveClass error:', error)
        next(error)
    }
}

// ━━━ GET CLASS STUDENTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/classes/:classId/students
export const getClassStudents = async (req, res, next) => {
    try {
        const { classId } = req.params

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers or HODs can view class students', 403, 'TEACHER_ONLY')
        }

        // 2. Fetch class document
        const classDoc = await db.collection('classes').doc(classId).get()
        if (!classDoc.exists) {
            return errorResponse(res, 'Class not found', 404, 'CLASS_NOT_FOUND')
        }

        const classData = classDoc.data()

        // 3. Verify access — teacher's class or HOD's department
        if (req.user.role === 'teacher' && classData.teacherId !== req.user.uid) {
            return errorResponse(res, 'Unauthorized — not your class', 403, 'NOT_YOUR_CLASS')
        }
        if (req.user.role === 'hod' && classData.departmentId !== req.user.departmentId) {
            return errorResponse(res, 'Unauthorized — class is not in your department', 403, 'UNAUTHORIZED')
        }

        // 4. Get student UIDs from class
        const studentIds = classData.students || []
        if (studentIds.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
                count: 0,
                message: 'No students enrolled in this class'
            })
        }

        // 5. Fetch all student documents in parallel
        const studentDocs = await Promise.all(
            studentIds.map(uid => db.collection('students').doc(uid).get())
        )

        // 6. Fetch attendance summaries for this class in parallel
        const summaryDocs = await Promise.all(
            studentIds.map(uid =>
                db.collection('attendanceSummary').doc(uid + '_' + classId).get()
            )
        )

        // 7. Build response combining both
        const students = studentDocs
            .filter(doc => doc.exists)
            .map((doc, index) => {
                const student = doc.data()
                const summary = summaryDocs[index].exists ? summaryDocs[index].data() : null
                return {
                    studentId: doc.id,
                    name: student.name,
                    rollNumber: student.rollNumber,
                    semester: student.semester,
                    section: student.section,
                    isActive: student.isActive,
                    faceRegistered: student.faceRegistered || false,
                    attendance: summary ? {
                        present: summary.present,
                        late: summary.late,
                        absent: summary.absent,
                        totalSessions: summary.totalSessions,
                        percentage: summary.percentage,
                        isBelowThreshold: summary.isBelowThreshold
                    } : {
                        present: 0,
                        late: 0,
                        absent: 0,
                        totalSessions: 0,
                        percentage: 0,
                        isBelowThreshold: false
                    }
                }
            })

        // 8. Sort by name ascending
        students.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

        // 9. Return
        return res.status(200).json({
            success: true,
            data: students,
            count: students.length,
            classInfo: {
                subjectName: classData.subjectName,
                subjectCode: classData.subjectCode,
                semester: classData.semester,
                section: classData.section,
                minAttendance: classData.minAttendance,
                totalSessions: classData.totalSessions
            }
        })

    } catch (error) {
        console.error('getClassStudents error:', error)
        next(error)
    }
}

// ━━━ GET STUDENT CLASSES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/classes/my-classes
export const getStudentClasses = async (req, res, next) => {
    try {
        // 1. Verify student role
        if (req.user.role !== 'student') {
            return errorResponse(res, 'This route is for students only', 403, 'STUDENT_ONLY')
        }

        // 2. Fetch student document
        const studentDoc = await db.collection('students').doc(req.user.uid).get()
        if (!studentDoc.exists) {
            return errorResponse(res, 'Student profile not found', 404, 'USER_NOT_FOUND')
        }

        const enrolledClassIds = studentDoc.data().enrolledClasses || []

        if (enrolledClassIds.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
                count: 0,
                message: 'You are not enrolled in any classes yet'
            })
        }

        // 3. Fetch all class documents and summaries in parallel
        const [classDocs, summaryDocs] = await Promise.all([
            Promise.all(
                enrolledClassIds.map(id => db.collection('classes').doc(id).get())
            ),
            Promise.all(
                enrolledClassIds.map(id =>
                    db.collection('attendanceSummary').doc(req.user.uid + '_' + id).get()
                )
            )
        ])

        // 4. Build response — only active classes
        const classes = classDocs
            .map((doc, index) => {
                if (!doc.exists || doc.data().isActive !== true) return null

                const cls = doc.data()
                const summary = summaryDocs[index].exists ? summaryDocs[index].data() : null

                return {
                    classId: doc.id,
                    subjectName: cls.subjectName,
                    subjectCode: cls.subjectCode,
                    teacherName: cls.teacherName,
                    semester: cls.semester,
                    section: cls.section,
                    minAttendance: cls.minAttendance,
                    totalSessions: cls.totalSessions,
                    attendance: summary ? {
                        present: summary.present,
                        late: summary.late,
                        absent: summary.absent,
                        totalSessions: summary.totalSessions,
                        percentage: summary.percentage,
                        isBelowThreshold: summary.isBelowThreshold
                    } : {
                        present: 0,
                        late: 0,
                        absent: 0,
                        totalSessions: 0,
                        percentage: 0,
                        isBelowThreshold: false
                    }
                }
            })
            .filter(Boolean)

        // 5. Return
        return res.status(200).json({
            success: true,
            data: classes,
            count: classes.length
        })

    } catch (error) {
        console.error('getStudentClasses error:', error)
        next(error)
    }
}

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

        // Fetch active sessions for this teacher to enrich the class list
        const activeSessionsSnapshot = await db.collection('sessions')
            .where('teacherId', '==', req.user.uid)
            .where('status', '==', 'active')
            .get()
        
        const activeSessionMap = {}
        activeSessionsSnapshot.forEach(doc => {
            const sessData = doc.data()
            activeSessionMap[sessData.classId] = doc.id
        })

        const classes = snapshot.docs.map(doc => {
            const data = doc.data()
            const classId = data.classId || doc.id
            return {
                classId,
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
                hasActiveSession: !!activeSessionMap[classId],
                activeSessionId: activeSessionMap[classId] || null,
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

        // 1 + 3. PARALLELIZED: class doc and active session are independent reads
        const [classDoc, activeSession] = await Promise.all([
            db.collection('classes').doc(classId).get(),
            db.collection('sessions')
                .where('classId', '==', classId)
                .where('status', '==', 'active')
                .limit(1)
                .get()
        ])

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

        // 5. De-duplicate and extract UIDs + sections
        const studentDataMap = new Map()
        for (const item of studentIds) {
            if (!item) continue
            let uid = ''
            let section = null
            if (typeof item === 'object') {
                uid = String(item.uid || item.id || '').trim()
                if (item.section) section = String(item.section).trim().toUpperCase()
            } else {
                uid = String(item).trim()
            }
            if (uid && !studentDataMap.has(uid)) {
                studentDataMap.set(uid, section)
            }
        }
        const uniqueIds = Array.from(studentDataMap.keys())

        // 6. Validate each UID in parallel against both 'students' and 'users' collections
        const validationResults = await Promise.all(
            uniqueIds.map(async (uid) => {
                const [studentDoc, userDoc] = await Promise.all([
                    db.collection('students').doc(uid).get(),
                    db.collection('users').doc(uid).get()
                ])
                const exists = studentDoc.exists || userDoc.exists
                const activeDoc = studentDoc.exists ? studentDoc : userDoc
                const data = activeDoc.exists ? activeDoc.data() : null
                const role = data?.role ?? null
                const isActive = data?.isActive !== false
                const name = data?.name ?? null
                return { uid, exists, role, name, isActive }
            })
        )

        // 7. Bucket each UID by outcome
        const notFound = []        // UID not in DB at all
        const invalidRole = []     // UID exists but is not a 'student'
        const deactivated = []     // UID is a student but account is deactivated
        const alreadyEnrolled = [] // UID is already in this class
        const toEnroll = []        // Valid, new students to add

        const existingStudents = new Set(classData.students || [])

        for (const r of validationResults) {
            if (!r.exists) {
                notFound.push(r.uid)
            } else if (r.role !== 'student') {
                invalidRole.push(r.uid)
            } else if (!r.isActive) {
                deactivated.push(r.uid)
            } else if (existingStudents.has(r.uid)) {
                alreadyEnrolled.push(r.uid)
            } else {
                toEnroll.push(r)
            }
        }

        // 8. Enroll valid, not-yet-enrolled students via Firestore batch
        if (toEnroll.length > 0) {
            const batch = db.batch()
            const classRef = db.collection('classes').doc(classId)

            for (const student of toEnroll) {
                batch.update(classRef, {
                    students: FieldValue.arrayUnion(student.uid),
                    updatedAt: FieldValue.serverTimestamp()
                })

                const studentRef = db.collection('students').doc(student.uid)
                const studentUpdates = {
                    enrolledClasses: FieldValue.arrayUnion(classId),
                    updatedAt: FieldValue.serverTimestamp()
                }
                const providedSection = studentDataMap.get(student.uid)
                if (providedSection) {
                    studentUpdates.section = providedSection
                }
                batch.update(studentRef, studentUpdates)

                const enrollmentRef = db.collection('enrollments').doc(`${student.uid}_${classId}`)
                batch.set(enrollmentRef, {
                    studentId: student.uid,
                    classId,
                    enrolledAt: FieldValue.serverTimestamp(),
                    status: 'active',
                    teacherId: classData.teacherId,
                    subjectName: classData.subjectName,
                }, { merge: true })
            }

            await batch.commit()
        }

        const enrolledUids = toEnroll.map(s => s.uid)

        // 9. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.STUDENT_ADDED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                enrolledCount: enrolledUids.length,
                alreadyEnrolledCount: alreadyEnrolled.length,
                notFoundCount: notFound.length,
                invalidRoleCount: invalidRole.length,
                enrolledUids
            }),
            classData.departmentId,
            req.ip
        )

        // 10. Return structured response matching frontend expectations
        return res.status(200).json({
            success: true,
            message: `${enrolledUids.length} student(s) enrolled successfully.`,
            data: {
                enrolled: enrolledUids,
                alreadyEnrolled,
                notFound,
                invalidRole,
                deactivated,
                totalStudents: (classData.students || []).length + enrolledUids.length
            }
        })

    } catch (error) {
        console.error('addStudentsToClass error:', error)
        next(error)
    }
}


// ━━━ ADD STUDENTS FROM EXCEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/classes/:classId/students/excel
export const addStudentsFromExcel = async (req, res, next) => {
    try {
        const { classId } = req.params
        const { students } = req.body // Expected: [{ rollNumber: "...", section: "..." }]

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers or HODs can add students', 403, 'TEACHER_ONLY')
        }

        // 2. Validate students array
        if (!students || !Array.isArray(students) || students.length === 0) {
            return errorResponse(res, 'students must be a non-empty array', 400, 'VALIDATION_ERROR')
        }

        // 3. Fetch class document and verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 4. Verify class is active
        if (!classData.isActive) {
            return errorResponse(res, 'Cannot add students to an archived class', 400, 'CLASS_ARCHIVED')
        }

        // 5. De-duplicate input based on rollNumber
        const uniqueStudentsMap = new Map()
        for (const s of students) {
            if (s && s.rollNumber) {
                const rNum = String(s.rollNumber).trim().toUpperCase()
                if (!uniqueStudentsMap.has(rNum)) {
                    uniqueStudentsMap.set(rNum, {
                        rollNumber: rNum,
                        section: s.section ? String(s.section).trim().toUpperCase() : null
                    })
                }
            }
        }
        const uniqueStudents = Array.from(uniqueStudentsMap.values())

        if (uniqueStudents.length === 0) {
            return errorResponse(res, 'No valid roll numbers provided in the payload', 400, 'VALIDATION_ERROR')
        }

        // 6. Validate each student by rollNumber in parallel
        const validationResults = await Promise.all(
            uniqueStudents.map(async (inputObj) => {
                // A student should primarily be in the 'students' collection or legacy 'users' collection
                const [studentSnap, userSnap] = await Promise.all([
                    db.collection('students').where('rollNumber', '==', inputObj.rollNumber).limit(1).get(),
                    db.collection('users').where('rollNumber', '==', inputObj.rollNumber).where('role', '==', 'student').limit(1).get()
                ])

                const exists = !studentSnap.empty || !userSnap.empty
                const activeDoc = !studentSnap.empty ? studentSnap.docs[0] : (!userSnap.empty ? userSnap.docs[0] : null)
                const data = activeDoc ? activeDoc.data() : null
                
                const uid = activeDoc ? activeDoc.id : null
                const role = data?.role ?? null
                const isActive = data?.isActive !== false
                const name = data?.name ?? null
                const dbSection = data?.section ? String(data.section).trim().toUpperCase() : null

                return { 
                    inputRollNumber: inputObj.rollNumber,
                    inputSection: inputObj.section,
                    uid,
                    exists, 
                    role, 
                    name, 
                    isActive,
                    dbSection
                }
            })
        )

        // 7. Bucket each student by outcome
        const notFound = []        // Roll number not in DB
        const sectionMismatch = [] // Roll number exists, but sections don't match
        const invalidRole = []     // Exists, but role is not 'student'
        const deactivated = []     // Account deactivated
        const alreadyEnrolled = [] // Already in this class
        const toEnroll = []        // Valid, new students to add

        const existingStudents = new Set(classData.students || [])

        for (const r of validationResults) {
            if (!r.exists) {
                notFound.push(r.inputRollNumber)
            } else if (r.role !== 'student') {
                invalidRole.push(r.inputRollNumber)
            } else if (!r.isActive) {
                deactivated.push(r.inputRollNumber)
            } else if (r.inputSection && r.dbSection && r.inputSection !== r.dbSection) {
                sectionMismatch.push(`${r.inputRollNumber} (Excel: ${r.inputSection}, DB: ${r.dbSection})`)
            } else if (existingStudents.has(r.uid)) {
                alreadyEnrolled.push(r.inputRollNumber)
            } else {
                toEnroll.push(r)
            }
        }

        // 8. Enroll valid, not-yet-enrolled students via Firestore batch
        if (toEnroll.length > 0) {
            const batch = db.batch()
            const classRef = db.collection('classes').doc(classId)

            for (const student of toEnroll) {
                batch.update(classRef, {
                    students: FieldValue.arrayUnion(student.uid),
                    updatedAt: FieldValue.serverTimestamp()
                })

                const studentRef = db.collection('students').doc(student.uid)
                batch.update(studentRef, {
                    enrolledClasses: FieldValue.arrayUnion(classId),
                    updatedAt: FieldValue.serverTimestamp()
                })

                const enrollmentRef = db.collection('enrollments').doc(`${student.uid}_${classId}`)
                batch.set(enrollmentRef, {
                    studentId: student.uid,
                    classId,
                    enrolledAt: FieldValue.serverTimestamp(),
                    status: 'active',
                    teacherId: classData.teacherId,
                    subjectName: classData.subjectName,
                }, { merge: true })
            }

            await batch.commit()
        }

        const enrolledRollNumbers = toEnroll.map(s => s.inputRollNumber)

        // 9. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.STUDENT_ADDED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                method: 'excel_import',
                enrolledCount: enrolledRollNumbers.length,
                alreadyEnrolledCount: alreadyEnrolled.length,
                notFoundCount: notFound.length,
                sectionMismatchCount: sectionMismatch.length,
                enrolledRollNumbers
            }),
            classData.departmentId,
            req.ip
        )

        // 10. Return structured response matching frontend expectations
        return res.status(200).json({
            success: true,
            message: `${enrolledRollNumbers.length} student(s) enrolled successfully from Excel.`,
            data: {
                enrolled: enrolledRollNumbers,
                alreadyEnrolled,
                notFound,
                sectionMismatch,
                invalidRole,
                deactivated,
                totalStudents: (classData.students || []).length + enrolledRollNumbers.length
            }
        })

    } catch (error) {
        console.error('addStudentsFromExcel error:', error)
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

        const enrollmentRef = db.collection('enrollments').doc(`${studentId}_${classId}`)
        batch.delete(enrollmentRef)

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
                    uid: doc.id,
                    name: student.name,
                    email: student.email,
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

// ━━━ IMPORT STUDENTS TO CLASS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/classes/import-students
/**
 * Import students into a class by matching on their studentId field in the users collection.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export const importStudents = async (req, res, next) => {
    try {
        const { classId, students } = req.body

        // 1. Verify teacher or hod role
        if (req.user.role !== 'teacher' && req.user.role !== 'hod') {
            return errorResponse(res, 'Only teachers or HODs can import students', 403, 'TEACHER_ONLY')
        }

        // 2. Validate input
        if (!classId || typeof classId !== 'string') {
            return errorResponse(res, 'classId is required', 400, 'VALIDATION_ERROR')
        }
        if (!Array.isArray(students) || students.length === 0) {
            return errorResponse(res, 'students must be a non-empty array', 400, 'EMPTY_LIST')
        }
        const hasInvalidFormat = students.some(
            s => !s || typeof s.name !== 'string' || typeof s.studentId !== 'string' || typeof s.email !== 'string'
        )
        if (hasInvalidFormat) {
            return errorResponse(res, 'Each student must have name, studentId, and email fields', 400, 'INVALID_FORMAT')
        }

        // 3. Fetch class document and verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 4. Verify class is active
        if (!classData.isActive) {
            return errorResponse(res, 'Cannot import students into an archived class', 400, 'CLASS_ARCHIVED')
        }

        // 5. Look up each student in the users collection by studentId field (parallel)
        const importedStudents = []
        const notFound = []

        await Promise.all(students.map(async (student) => {
            const snap = await db.collection('users')
                .where('studentId', '==', student.studentId)
                .where('role', '==', 'student')
                .limit(1)
                .get()

            if (snap.empty) {
                notFound.push({ studentId: student.studentId, name: student.name })
                return
            }

            const uid = snap.docs[0].id
            if (classData.students?.includes(uid)) return // already enrolled — skip silently

            importedStudents.push({ uid, studentId: student.studentId, name: student.name })
        }))

        // 6. Batch write all updates atomically
        if (importedStudents.length > 0) {
            const batch = db.batch()
            const classRef = db.collection('classes').doc(classId)

            for (const student of importedStudents) {
                batch.update(classRef, {
                    students: FieldValue.arrayUnion(student.uid),
                    updatedAt: FieldValue.serverTimestamp()
                })

                const studentRef = db.collection('students').doc(student.uid)
                batch.update(studentRef, {
                    enrolledClasses: FieldValue.arrayUnion(classId),
                    updatedAt: FieldValue.serverTimestamp()
                })

                const enrollmentRef = db.collection('enrollments').doc(`${student.uid}_${classId}`)
                batch.set(enrollmentRef, {
                    studentId: student.uid,
                    classId,
                    enrolledAt: FieldValue.serverTimestamp(),
                    status: 'active',
                    teacherId: classData.teacherId,
                    subjectName: classData.subjectName,
                })
            }

            await batch.commit()
        }

        // 7. Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.STUDENT_ADDED,
            req.user.uid,
            getActorRole(req.user.role),
            classId,
            TARGET_TYPES.CLASS,
            createDetails({
                importedCount: importedStudents.length,
                notFoundCount: notFound.length,
                studentIds: importedStudents.map(s => s.studentId)
            }),
            classData.departmentId,
            req.ip
        )

        // 8. Return
        return successResponse(res, {
            imported: importedStudents.length,
            notFound,
            message: `${importedStudents.length} student(s) imported, ${notFound.length} not found`
        })

    } catch (error) {
        console.error('importStudents error:', error)
        next(error)
    }
}

// ━━━ GET STUDENT CLASSES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/classes/my-classes
export const getStudentClasses = async (req, res, next) => {
    try {
        // 1. Get req.user.uid from token
        const uid = req.user.uid

        // 2. Query enrollments where studentId == uid
        const enrollmentQuery = await db.collection('enrollments')
            .where('studentId', '==', uid)
            .get()

        if (enrollmentQuery.empty) {
            return res.status(200).json({
                success: true,
                data: [],
                message: 'You are not enrolled in any classes yet'
            })
        }

        const enrolledClassIds = enrollmentQuery.docs.map(doc => doc.data().classId)

        // 3. For each enrollment, get class details
        // 4. Check for active session in each class
        const classesData = []

        // To avoid N+1 issues but keeping logic simple for exact prompt matching:
        // We will fetch classes in a single query if possible, or batch get.
        // It's safer to use Promise.all to fetch them individually mapped.
        await Promise.all(enrolledClassIds.map(async (classId) => {
            if (!classId) return

            // PARALLELIZED: class doc, active session, latest attendance are independent reads
            const [classDoc, activeSession, latestAttendanceQuery] = await Promise.all([
                db.collection('classes').doc(classId).get(),
                db.collection('sessions')
                    .where('classId', '==', classId)
                    .where('status', '==', 'active')
                    .limit(1)
                    .get(),
                // FIX (Bug 2): Removed .orderBy('createdAt', 'desc') — that compound query
                // (where + where + orderBy on a different field) requires a composite Firestore
                // index that was absent, causing FAILED_PRECONDITION → 503 DB_UNAVAILABLE.
                // We only need the latest attendanceId; ordering is not critical here.
                db.collection('attendance')
                    .where('classId', '==', classId)
                    .where('studentId', '==', uid)
                    .limit(1)
                    .get()
            ])

            if (classDoc.exists) {
                const cls = { id: classId, ...classDoc.data() }
                
                let latestAttendanceId = null;
                if (!latestAttendanceQuery.empty) {
                    latestAttendanceId = latestAttendanceQuery.docs[0].id;
                }

                classesData.push({
                    classId: cls.id,
                    subjectName: cls.subjectName,
                    subjectCode: cls.subjectCode,
                    semester: cls.semester,
                    section: cls.section,
                    teacherName: cls.teacherName,
                    hasActiveSession: !activeSession.empty,
                    activeSessionId: activeSession.empty ? null : activeSession.docs[0].id,
                    latestAttendanceId
                })
            }
        }))

        // Sort by subjectCode ascending for consistency (optional but helpful)
        classesData.sort((a, b) => (a.subjectCode || '').localeCompare(b.subjectCode || ''))

        return res.status(200).json({
            success: true,
            data: classesData
        })

    } catch (error) {
        console.error('getStudentClasses error:', error)
        // FIX (Bug 2): Detect missing Firestore composite index — surfaces as FAILED_PRECONDITION
        // (gRPC code 9). Return a distinct error code so callers can differentiate from a
        // true DB outage. Create the required index in Firebase Console to resolve permanently.
        if (
            error.code === 9 ||
            (error.message && error.message.includes('requires an index'))
        ) {
            console.error('[my-classes] Missing Firestore composite index — see:', error.message)
            return res.status(503).json({
                success: false,
                error: 'Service temporarily unavailable — index building',
                code: 'INDEX_BUILDING'
            })
        }
        if (next) return next(error)
        return res.status(500).json({ success: false, error: 'Database fetch failed' })
    }
}

// ━━━ GET STUDENT DASHBOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/classes/student-dashboard
// Returns enrolled classes + their active session status + attendance summary in one payload
export const getStudentDashboard = async (req, res, next) => {
    try {
        const uid = req.user.uid

        // 1. Fetch enrollments
        const enrollmentQuery = await db.collection('enrollments')
            .where('studentId', '==', uid)
            .get()

        if (enrollmentQuery.empty) {
            return res.status(200).json({
                success: true,
                data: {
                    overallPercentage: 0,
                    totalPresent: 0,
                    totalClassesAttended: 0,
                    classes: []
                },
                message: 'You are not enrolled in any classes'
            })
        }

        const enrolledClassIds = enrollmentQuery.docs.map(doc => doc.data().classId)
        
        // 2. Fetch classes, active sessions, and attendance summaries in parallel
        const classesData = []
        let totalPresentAll = 0
        let totalSessionsAll = 0

        await Promise.all(enrolledClassIds.map(async (classId) => {
            if (!classId) return

            // PARALLELIZED: class doc, active session, attendance snap are independent reads
            const [classDoc, activeSession, attendanceSnap] = await Promise.all([
                db.collection('classes').doc(classId).get(),
                db.collection('sessions')
                    .where('classId', '==', classId)
                    .where('status', '==', 'active')
                    .limit(1)
                    .get(),
                // FIX (Bug 1): Previously read from `attendanceSummary` collection, which
                // returns totalSessions=0 when the summary document hasn't been written yet.
                // Now we live-query the `attendance` collection directly (the source of truth):
                //   totalSessions = count of ALL attendance records for this student+class
                //   attended      = count where status === 'present'
                db.collection('attendance')
                    .where('studentId', '==', uid)
                    .where('classId', '==', classId)
                    .get()
            ])

            if (classDoc.exists) {
                const cls = { id: classId, ...classDoc.data() }

                const totalSessions = attendanceSnap.size
                const attended = attendanceSnap.docs.filter(d => d.data().status === 'present').length
                const percentage = totalSessions > 0
                    ? parseFloat(((attended / totalSessions) * 100).toFixed(1))
                    : 0
                const minAttendance = cls.minAttendance || 75

                const summary = {
                    present: attended,
                    late: attendanceSnap.docs.filter(d => d.data().status === 'late').length,
                    absent: attendanceSnap.docs.filter(d => d.data().status === 'absent').length,
                    totalSessions,
                    attended,
                    percentage,
                    isBelowThreshold: totalSessions > 0 && percentage < minAttendance
                }

                totalPresentAll += attended
                totalSessionsAll += totalSessions

                classesData.push({
                    classId: cls.id,
                    subjectName: cls.subjectName,
                    subjectCode: cls.subjectCode,
                    semester: cls.semester,
                    section: cls.section,
                    teacherName: cls.teacherName,
                    minAttendance: minAttendance,
                    hasActiveSession: !activeSession.empty,
                    activeSessionId: activeSession.empty ? null : activeSession.docs[0].id,
                    attendanceSummary: summary
                })
            }
        }))

        // Sort alphabetically by subject code
        classesData.sort((a, b) => (a.subjectCode || '').localeCompare(b.subjectCode || ''))

        // 3. Calculate overall stats
        const overallPercentage = totalSessionsAll > 0 
            ? Math.round((totalPresentAll / totalSessionsAll) * 100) 
            : 0

        return res.status(200).json({
            success: true,
            data: {
                overallPercentage,
                totalPresent: totalPresentAll,
                totalClassesAttended: totalSessionsAll,
                classes: classesData
            }
        })

    } catch (error) {
        console.error('getStudentDashboard error:', error)
        if (next) return next(error)
        return res.status(500).json({ success: false, error: 'Failed to fetch dashboard' })
    }
}

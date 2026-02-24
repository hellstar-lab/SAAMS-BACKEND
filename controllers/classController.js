import { db, admin } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'

// ─── Helpers ───────────────────────────────────────────────────────────────────

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
        return { error: { message: 'Unauthorized — not your class', code: 'UNAUTHORIZED', status: 403 } }
    }
    return { classData }
}

// ─── CREATE CLASS ──────────────────────────────────────────────────────────────
// POST /api/classes
export const createClass = async (req, res) => {
    try {
        const { subjectName, subjectCode, semester, academicYear, students, pendingStudents } = req.body

        // 1. Validate subjectName
        if (!subjectName || subjectName.trim().length < 3) {
            return errorResponse(res, 'Subject name is required and must be at least 3 characters', 400, 'VALIDATION_ERROR')
        }

        // 2. Validate semester (1–8)
        const semNum = Number(semester)
        if (!semester || isNaN(semNum) || semNum < 1 || semNum > 8) {
            return errorResponse(res, 'Semester must be a number between 1 and 8', 400, 'VALIDATION_ERROR')
        }

        // 3. Verify requester is a teacher
        if (req.user.role !== 'teacher') {
            // Also check from Firestore in case role not in token claims
            const userDoc = await db.collection('users').doc(req.user.uid).get()
            if (!userDoc.exists || userDoc.data().role !== 'teacher') {
                return errorResponse(res, 'Only teachers can create classes', 403, 'TEACHER_ONLY')
            }
        }

        // 4. Fetch teacher profile for department
        const teacherDoc = await db.collection('users').doc(req.user.uid).get()
        const teacherData = teacherDoc.exists ? teacherDoc.data() : {}

        // 5. Create class document
        const classData = {
            teacherId: req.user.uid,
            subjectName: subjectName.trim(),
            subjectCode: subjectCode || '',
            semester: semNum,
            academicYear: academicYear || '',
            department: teacherData.department || '',
            students: students || [],
            pendingStudents: pendingStudents || [],
            totalSessions: 0,
            lastSessionDate: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }

        const classRef = await db.collection('classes').add(classData)

        return successResponse(res, {
            message: 'Class created successfully',
            classId: classRef.id,
            class: { ...classData, id: classRef.id, createdAt: new Date().toISOString() }
        }, 201)

    } catch (error) {
        console.error('createClass error:', error)
        return errorResponse(res, 'Failed to create class', 500, 'SERVER_ERROR')
    }
}

// ─── GET TEACHER CLASSES ───────────────────────────────────────────────────────
// GET /api/classes/teacher
export const getTeacherClasses = async (req, res) => {
    try {
        const snapshot = await db.collection('classes')
            .where('teacherId', '==', req.user.uid)
            .get()

        const classes = snapshot.docs.map(doc => {
            const data = doc.data()
            return {
                id: doc.id,
                ...data,
                studentCount: (data.students?.length || 0) + (data.pendingStudents?.length || 0),
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                lastSessionDate: data.lastSessionDate?.toDate?.()?.toISOString() || null
            }
        })

        // Sort by createdAt descending in-memory (avoids composite index requirement)
        classes.sort((a, b) => {
            if (!a.createdAt) return 1
            if (!b.createdAt) return -1
            return new Date(b.createdAt) - new Date(a.createdAt)
        })

        return successResponse(res, { classes, total: classes.length })

    } catch (error) {
        console.error('getTeacherClasses error:', error)
        return errorResponse(res, 'Failed to fetch classes', 500, 'SERVER_ERROR')
    }
}

// ─── GET CLASS BY ID ───────────────────────────────────────────────────────────
// GET /api/classes/:classId
export const getClassById = async (req, res) => {
    try {
        const { classId } = req.params
        const uid = req.user.uid

        const classDoc = await db.collection('classes').doc(classId).get()
        if (!classDoc.exists) {
            return errorResponse(res, 'Class not found', 404, 'CLASS_NOT_FOUND')
        }

        const classData = { id: classDoc.id, ...classDoc.data() }

        // 2. Verify requester is the teacher OR a student in the class
        const isTeacher = classData.teacherId === uid
        const isStudent = classData.students?.includes(uid)

        if (!isTeacher && !isStudent) {
            return errorResponse(res, 'Unauthorized — not your class', 403, 'UNAUTHORIZED')
        }

        // 3. Fetch recent 5 ended sessions (sorted in-memory to avoid composite index)
        const sessionsSnap = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'ended')
            .get()

        const recentSessions = sessionsSnap.docs
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
            .slice(0, 5)

        return successResponse(res, {
            class: {
                ...classData,
                createdAt: classData.createdAt?.toDate?.()?.toISOString() || null,
                lastSessionDate: classData.lastSessionDate?.toDate?.()?.toISOString() || null
            },
            recentSessions
        })

    } catch (error) {
        console.error('getClassById error:', error)
        return errorResponse(res, 'Failed to fetch class', 500, 'SERVER_ERROR')
    }
}

// ─── UPDATE CLASS ──────────────────────────────────────────────────────────────
// PUT /api/classes/:classId
export const updateClass = async (req, res) => {
    try {
        const { classId } = req.params
        const { subjectName, subjectCode, semester, academicYear } = req.body

        // 1. Verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 2. Build update object with only provided fields
        const updateData = {}
        if (subjectName !== undefined) {
            if (subjectName.trim().length < 3) return errorResponse(res, 'Subject name must be at least 3 characters', 400, 'VALIDATION_ERROR')
            updateData.subjectName = subjectName.trim()
        }
        if (subjectCode !== undefined) updateData.subjectCode = subjectCode
        if (semester !== undefined) {
            const semNum = Number(semester)
            if (isNaN(semNum) || semNum < 1 || semNum > 8) return errorResponse(res, 'Semester must be 1–8', 400, 'VALIDATION_ERROR')
            updateData.semester = semNum
        }
        if (academicYear !== undefined) updateData.academicYear = academicYear

        if (Object.keys(updateData).length === 0) {
            return errorResponse(res, 'No fields provided to update', 400, 'VALIDATION_ERROR')
        }

        // 3. Add updatedAt and update
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp()
        await db.collection('classes').doc(classId).update(updateData)

        const updatedDoc = await db.collection('classes').doc(classId).get()

        return successResponse(res, {
            message: 'Class updated successfully',
            class: { id: updatedDoc.id, ...updatedDoc.data() }
        })

    } catch (error) {
        console.error('updateClass error:', error)
        return errorResponse(res, 'Failed to update class', 500, 'SERVER_ERROR')
    }
}

// ─── DELETE CLASS ──────────────────────────────────────────────────────────────
// DELETE /api/classes/:classId
export const deleteClass = async (req, res) => {
    try {
        const { classId } = req.params

        // 1. Verify ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 2. Check for active sessions
        const activeSessions = await db.collection('sessions')
            .where('classId', '==', classId)
            .where('status', '==', 'active')
            .limit(1)
            .get()

        if (!activeSessions.empty) {
            return errorResponse(res, 'Cannot delete class with an active session in progress', 400, 'ACTIVE_SESSION')
        }

        // 3. Delete class document
        await db.collection('classes').doc(classId).delete()

        return successResponse(res, { message: 'Class deleted successfully' })

    } catch (error) {
        console.error('deleteClass error:', error)
        return errorResponse(res, 'Failed to delete class', 500, 'SERVER_ERROR')
    }
}

// ─── ADD STUDENT ───────────────────────────────────────────────────────────────
// POST /api/classes/:classId/students/add
export const addStudent = async (req, res) => {
    try {
        const { classId } = req.params
        const { studentId } = req.body // Firebase UID

        if (!studentId) {
            return errorResponse(res, 'studentId is required', 400, 'VALIDATION_ERROR')
        }

        // 1. Verify teacher ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        // 2. Fetch student from users collection
        const studentDoc = await db.collection('users').doc(studentId).get()
        if (!studentDoc.exists) {
            return errorResponse(res, 'Student not found', 404, 'USER_NOT_FOUND')
        }

        const studentData = studentDoc.data()

        // 3. Verify student role
        if (studentData.role !== 'student') {
            return errorResponse(res, 'User is not a student', 400, 'NOT_A_STUDENT')
        }

        // 4. Check if already in class
        if (classData.students?.includes(studentId)) {
            return errorResponse(res, 'Student is already in this class', 400, 'ALREADY_IN_CLASS')
        }

        // 5. Add to students, remove from pendingStudents if listed there
        const updates = {
            students: admin.firestore.FieldValue.arrayUnion(studentId)
        }

        // Remove from pendingStudents if email or studentId matches
        const pendingToRemove = classData.pendingStudents?.filter(p =>
            p.email === studentData.email || p.studentId === studentData.studentId
        ) || []
        if (pendingToRemove.length > 0) {
            updates.pendingStudents = classData.pendingStudents.filter(p =>
                p.email !== studentData.email && p.studentId !== studentData.studentId
            )
        }

        await db.collection('classes').doc(classId).update(updates)

        return successResponse(res, {
            message: 'Student added successfully',
            student: {
                uid: studentId,
                name: studentData.name,
                email: studentData.email,
                studentId: studentData.studentId
            }
        })

    } catch (error) {
        console.error('addStudent error:', error)
        return errorResponse(res, 'Failed to add student', 500, 'SERVER_ERROR')
    }
}

// ─── REMOVE STUDENT ────────────────────────────────────────────────────────────
// POST /api/classes/:classId/students/remove
export const removeStudent = async (req, res) => {
    try {
        const { classId } = req.params
        const { studentId, isPending, pendingStudent } = req.body

        // 1. Verify teacher ownership
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        if (isPending) {
            // 2. Remove from pendingStudents array by matching object
            if (!pendingStudent) {
                return errorResponse(res, 'pendingStudent object required when isPending is true', 400, 'VALIDATION_ERROR')
            }
            const updatedPending = (classData.pendingStudents || []).filter(p =>
                !(p.studentId === pendingStudent.studentId || p.email === pendingStudent.email)
            )
            await db.collection('classes').doc(classId).update({ pendingStudents: updatedPending })
        } else {
            // 3. Remove from registered students array
            if (!studentId) return errorResponse(res, 'studentId is required', 400, 'VALIDATION_ERROR')
            await db.collection('classes').doc(classId).update({
                students: admin.firestore.FieldValue.arrayRemove(studentId)
            })
        }

        return successResponse(res, { message: 'Student removed successfully' })

    } catch (error) {
        console.error('removeStudent error:', error)
        return errorResponse(res, 'Failed to remove student', 500, 'SERVER_ERROR')
    }
}

// ─── IMPORT STUDENTS ───────────────────────────────────────────────────────────
// POST /api/classes/:classId/students/import
export const importStudents = async (req, res) => {
    try {
        const { classId } = req.params
        const { students } = req.body // [{ StudentName, StudentID, Email }]

        if (!students || !Array.isArray(students) || students.length === 0) {
            return errorResponse(res, 'students array is required', 400, 'VALIDATION_ERROR')
        }

        // 1. Verify teacher ownership
        const { error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        const matchedUIDs = []
        const pendingList = []

        // 2. For each student try to find in Firestore by studentId
        for (const student of students) {
            const snap = await db.collection('users')
                .where('studentId', '==', student.StudentID)
                .where('role', '==', 'student')
                .limit(1)
                .get()

            if (!snap.empty) {
                matchedUIDs.push(snap.docs[0].id)
            } else {
                pendingList.push({
                    studentName: student.StudentName || '',
                    studentId: student.StudentID || '',
                    email: student.Email || '',
                    status: 'pending'
                })
            }
        }

        // 3. Batch update class document
        const updateData = {}
        if (matchedUIDs.length > 0) {
            updateData.students = admin.firestore.FieldValue.arrayUnion(...matchedUIDs)
        }
        if (pendingList.length > 0) {
            // Get current pending and merge (avoid duplicates by studentId)
            const classDoc = await db.collection('classes').doc(classId).get()
            const existing = classDoc.data().pendingStudents || []
            const existingIds = new Set(existing.map(p => p.studentId))
            const newPending = pendingList.filter(p => !existingIds.has(p.studentId))
            updateData.pendingStudents = admin.firestore.FieldValue.arrayUnion(...newPending)
        }

        if (Object.keys(updateData).length > 0) {
            await db.collection('classes').doc(classId).update(updateData)
        }

        return successResponse(res, {
            message: 'Students imported successfully',
            matched: matchedUIDs.length,
            pending: pendingList.length,
            total: students.length
        })

    } catch (error) {
        console.error('importStudents error:', error)
        return errorResponse(res, 'Failed to import students', 500, 'SERVER_ERROR')
    }
}

// ─── GET CLASS STUDENTS ────────────────────────────────────────────────────────
// GET /api/classes/:classId/students
export const getClassStudents = async (req, res) => {
    try {
        const { classId } = req.params

        // 1. Fetch class + verify teacher
        const { classData, error } = await fetchAndVerifyOwnership(classId, req.user.uid)
        if (error) return errorResponse(res, error.message, error.status, error.code)

        const studentUIDs = classData.students || []
        const totalSessions = classData.totalSessions || 0

        // 3. Fetch full profiles for each registered student
        const registeredStudents = await Promise.all(
            studentUIDs.map(async (uid) => {
                try {
                    const userDoc = await db.collection('users').doc(uid).get()
                    if (!userDoc.exists) return null

                    const userData = userDoc.data()

                    // 4. Calculate attendance percentage
                    let attendancePercent = 0
                    if (totalSessions > 0) {
                        const attendanceSnap = await db.collection('attendance')
                            .where('classId', '==', classId)
                            .where('studentId', '==', uid)
                            .where('status', 'in', ['present', 'late'])
                            .get()
                        attendancePercent = Math.round((attendanceSnap.size / totalSessions) * 100)
                    }

                    return {
                        uid,
                        name: userData.name,
                        email: userData.email,
                        studentId: userData.studentId,
                        department: userData.department,
                        attendancePercent
                    }
                } catch (e) {
                    console.error(`getClassStudents: failed to fetch uid ${uid}:`, e)
                    return null
                }
            })
        )

        return successResponse(res, {
            registered: registeredStudents.filter(Boolean),
            pending: classData.pendingStudents || [],
            totalSessions
        })

    } catch (error) {
        console.error('getClassStudents error:', error)
        return errorResponse(res, 'Failed to fetch students', 500, 'SERVER_ERROR')
    }
}

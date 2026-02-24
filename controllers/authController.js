import { db, admin, auth } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getUserCollection = (role) => {
    if (role === 'teacher') return 'teachers'
    if (role === 'student') return 'students'
    throw new Error('Invalid role')
}

const getUserFromDB = async (uid, role) => {
    const col = getUserCollection(role)
    const doc = await db.collection(col).doc(uid).get()
    if (!doc.exists) return null
    return { id: doc.id, ...doc.data() }
}

const validateRequired = (fields, body) => {
    for (const f of fields) {
        if (!body[f] || String(body[f]).trim() === '') return `${f} is required`
    }
    return null
}
const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
const validatePassword = (p) => p && p.length >= 8

// ─── REGISTER ─────────────────────────────────────────────────────────────────
// POST /api/auth/register
export const registerUser = async (req, res) => {
    try {
        const { name, email, password, role, employeeId, studentId, department, semester, phone } = req.body

        // Validate commons
        const err = validateRequired(['name', 'email', 'password', 'role'], req.body)
        if (err) return errorResponse(res, err, 400, 'VALIDATION_ERROR')
        if (!validateEmail(email)) return errorResponse(res, 'Invalid email address', 400, 'INVALID_EMAIL')
        if (!validatePassword(password)) return errorResponse(res, 'Password must be at least 8 characters', 400, 'WEAK_PASSWORD')
        if (!['teacher', 'student'].includes(role)) return errorResponse(res, 'role must be teacher or student', 400, 'INVALID_ROLE')

        // Role-specific required fields
        if (role === 'teacher' && !employeeId) return errorResponse(res, 'employeeId is required for teachers', 400, 'VALIDATION_ERROR')
        if (role === 'student' && !studentId) return errorResponse(res, 'studentId is required for students', 400, 'VALIDATION_ERROR')

        // Create Firebase Auth user
        let userRecord
        try {
            userRecord = await auth.createUser({ email: email.trim(), password, displayName: name.trim() })
        } catch (e) {
            if (e.code === 'auth/email-already-exists') return errorResponse(res, 'Email already registered', 409, 'EMAIL_EXISTS')
            if (e.code === 'auth/invalid-email') return errorResponse(res, 'Invalid email address', 400, 'INVALID_EMAIL')
            if (e.code === 'auth/weak-password') return errorResponse(res, 'Password is too weak', 400, 'WEAK_PASSWORD')
            throw e
        }

        const uid = userRecord.uid
        const now = admin.firestore.FieldValue.serverTimestamp()

        let userData
        if (role === 'teacher') {
            userData = {
                uid, name: name.trim(), email: email.trim(),
                employeeId: employeeId || '', department: department || '',
                phone: phone || '', role: 'teacher', faceData: null,
                createdAt: now, updatedAt: now, lastLoginAt: null
            }
            await db.collection('teachers').doc(uid).set(userData)
        } else {
            userData = {
                uid, name: name.trim(), email: email.trim(),
                studentId: studentId || '', department: department || '',
                semester: Number(semester) || 1, phone: phone || '',
                role: 'student', faceData: null, enrolledClasses: [],
                createdAt: now, updatedAt: now, lastLoginAt: null
            }
            await db.collection('students').doc(uid).set(userData)
        }

        const { faceData, ...safeData } = userData
        return successResponse(res, { message: 'User registered successfully', uid, user: safeData }, 201)

    } catch (error) {
        console.error('registerUser error:', error)
        return errorResponse(res, 'Registration failed', 500, 'SERVER_ERROR')
    }
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
// POST /api/auth/login
export const loginUser = async (req, res) => {
    try {
        const { idToken } = req.body
        if (!idToken) return errorResponse(res, 'idToken is required', 400, 'VALIDATION_ERROR')

        const decoded = await auth.verifyIdToken(idToken)
        const uid = decoded.uid

        // Check teachers first, then students
        let user = await getUserFromDB(uid, 'teacher')
        let role = 'teacher'
        if (!user) {
            user = await getUserFromDB(uid, 'student')
            role = 'student'
        }
        if (!user) return errorResponse(res, 'User not found in database', 404, 'USER_NOT_FOUND')

        await db.collection(getUserCollection(role)).doc(uid).update({ lastLoginAt: admin.firestore.FieldValue.serverTimestamp() })

        const { faceData, ...safeData } = user
        return successResponse(res, { message: 'Login successful', user: { ...safeData, role } })

    } catch (error) {
        console.error('loginUser error:', error)
        return errorResponse(res, 'Login failed', 500, 'SERVER_ERROR')
    }
}

// ─── GET PROFILE ──────────────────────────────────────────────────────────────
// GET /api/auth/profile
export const getProfile = async (req, res) => {
    try {
        const { uid, role } = req.user
        const user = await getUserFromDB(uid, role)
        if (!user) return errorResponse(res, 'Profile not found', 404, 'USER_NOT_FOUND')

        const { faceData, ...safeData } = user
        return successResponse(res, { user: safeData })

    } catch (error) {
        console.error('getProfile error:', error)
        return errorResponse(res, 'Failed to fetch profile', 500, 'SERVER_ERROR')
    }
}

// ─── UPDATE PROFILE ───────────────────────────────────────────────────────────
// PUT /api/auth/profile
export const updateProfile = async (req, res) => {
    try {
        const { uid, role } = req.user
        const { name, phone, department, employeeId, studentId, semester } = req.body

        const updateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
        if (name !== undefined) updateData.name = name.trim()
        if (phone !== undefined) updateData.phone = phone
        if (department !== undefined) updateData.department = department
        if (role === 'teacher' && employeeId !== undefined) updateData.employeeId = employeeId
        if (role === 'student' && studentId !== undefined) updateData.studentId = studentId
        if (role === 'student' && semester !== undefined) updateData.semester = Number(semester)

        if (Object.keys(updateData).length === 1) return errorResponse(res, 'No fields provided to update', 400, 'VALIDATION_ERROR')

        const col = getUserCollection(role)
        await db.collection(col).doc(uid).update(updateData)
        if (name) await auth.updateUser(uid, { displayName: name.trim() })

        const updated = await getUserFromDB(uid, role)
        const { faceData, ...safeData } = updated
        return successResponse(res, { message: 'Profile updated', user: safeData })

    } catch (error) {
        console.error('updateProfile error:', error)
        return errorResponse(res, 'Failed to update profile', 500, 'SERVER_ERROR')
    }
}

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
// POST /api/auth/change-password
export const changePassword = async (req, res) => {
    try {
        const { newPassword } = req.body
        if (!validatePassword(newPassword)) return errorResponse(res, 'New password must be at least 8 characters', 400, 'WEAK_PASSWORD')
        await auth.updateUser(req.user.uid, { password: newPassword })
        return successResponse(res, { message: 'Password changed successfully' })
    } catch (error) {
        console.error('changePassword error:', error)
        return errorResponse(res, 'Failed to change password', 500, 'SERVER_ERROR')
    }
}

// ─── DELETE ACCOUNT ───────────────────────────────────────────────────────────
// DELETE /api/auth/account
export const deleteAccount = async (req, res) => {
    try {
        const { uid, role } = req.user
        await db.collection(getUserCollection(role)).doc(uid).delete()
        await auth.deleteUser(uid)
        return successResponse(res, { message: 'Account deleted successfully' })
    } catch (error) {
        console.error('deleteAccount error:', error)
        return errorResponse(res, 'Failed to delete account', 500, 'SERVER_ERROR')
    }
}

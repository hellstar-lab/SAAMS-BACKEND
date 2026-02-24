import { db, auth, admin } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'

// ─── Validation Helpers ───────────────────────────────────────────────────────

const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const validatePassword = (password) => {
    return password && password.length >= 8
}

const validateRequired = (fields, body) => {
    const missing = fields.filter(f => !body[f])
    if (missing.length > 0) {
        return `Missing required fields: ${missing.join(', ')}`
    }
    return null
}

// ─── REGISTER USER ────────────────────────────────────────────────────────────
// POST /api/auth/register
export const registerUser = async (req, res) => {
    try {
        const { name, email, password, role, employeeId, studentId, department } = req.body

        // 1. Validate required fields
        const missingError = validateRequired(['name', 'email', 'password', 'role'], req.body)
        if (missingError) return errorResponse(res, missingError, 400, 'VALIDATION_ERROR')

        // 2. Validate email format
        if (!validateEmail(email)) {
            return errorResponse(res, 'Invalid email format', 400, 'INVALID_EMAIL')
        }

        // 3. Validate password length
        if (!validatePassword(password)) {
            return errorResponse(res, 'Password must be at least 8 characters', 400, 'WEAK_PASSWORD')
        }

        // 4. Validate role
        if (!['teacher', 'student'].includes(role)) {
            return errorResponse(res, "Role must be 'teacher' or 'student'", 400, 'INVALID_ROLE')
        }

        // 5. Create Firebase Auth user
        const userRecord = await auth.createUser({
            email,
            password,
            displayName: name
        })

        // 6. Save to Firestore
        const userData = {
            uid: userRecord.uid,
            name,
            email,
            role,
            employeeId: employeeId || null,
            studentId: studentId || null,
            department: department || null,
            faceData: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }

        await db.collection('users').doc(userRecord.uid).set(userData)

        // 7. Return success with uid
        return successResponse(res, {
            message: 'User registered successfully',
            uid: userRecord.uid,
            user: { ...userData, createdAt: new Date().toISOString() }
        }, 201)

    } catch (error) {
        console.error('registerUser error:', error)

        if (error.code === 'auth/email-already-exists') {
            return errorResponse(res, 'Email already registered', 409, 'EMAIL_EXISTS')
        }
        if (error.code === 'auth/invalid-email') {
            return errorResponse(res, 'Invalid email format', 400, 'INVALID_EMAIL')
        }
        if (error.code === 'auth/weak-password') {
            return errorResponse(res, 'Password too weak', 400, 'WEAK_PASSWORD')
        }

        return errorResponse(res, 'Registration failed', 500, 'SERVER_ERROR')
    }
}

// ─── LOGIN (TOKEN VERIFICATION) ───────────────────────────────────────────────
// POST /api/auth/login
// Client-side Firebase login sends the idToken to this endpoint for verification
export const loginUser = async (req, res) => {
    try {
        const { idToken } = req.body

        if (!idToken) {
            return errorResponse(res, 'idToken is required', 400, 'VALIDATION_ERROR')
        }

        // 1. Verify idToken with Firebase Admin
        const decodedToken = await auth.verifyIdToken(idToken)
        const uid = decodedToken.uid

        // 2. Fetch user from Firestore
        const userDoc = await db.collection('users').doc(uid).get()

        if (!userDoc.exists) {
            return errorResponse(res, 'User profile not found', 404, 'USER_NOT_FOUND')
        }

        const userData = userDoc.data()

        // 3. Update lastLoginAt in Firestore
        await db.collection('users').doc(uid).update({
            lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
        })

        // 4. Return user profile data
        return successResponse(res, {
            message: 'Login verified successfully',
            user: {
                uid: userData.uid,
                name: userData.name,
                email: userData.email,
                role: userData.role,
                employeeId: userData.employeeId,
                studentId: userData.studentId,
                department: userData.department
            }
        })

    } catch (error) {
        console.error('loginUser error:', error)

        if (error.code === 'auth/id-token-expired') {
            return errorResponse(res, 'Token has expired. Please log in again.', 401, 'TOKEN_EXPIRED')
        }
        if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-id-token') {
            return errorResponse(res, 'Invalid token', 401, 'AUTH_INVALID')
        }

        return errorResponse(res, 'Login verification failed', 500, 'SERVER_ERROR')
    }
}

// ─── GET PROFILE ──────────────────────────────────────────────────────────────
// GET /api/auth/profile
// Requires: Authorization: Bearer {idToken}
export const getProfile = async (req, res) => {
    try {
        const uid = req.user.uid

        const userDoc = await db.collection('users').doc(uid).get()

        if (!userDoc.exists) {
            return errorResponse(res, 'User profile not found', 404, 'USER_NOT_FOUND')
        }

        const userData = userDoc.data()

        // Return user data, excluding sensitive fields like faceData
        const { faceData, ...safeData } = userData

        return successResponse(res, { user: safeData })

    } catch (error) {
        console.error('getProfile error:', error)
        return errorResponse(res, 'Failed to fetch profile', 500, 'SERVER_ERROR')
    }
}

// ─── UPDATE PROFILE ───────────────────────────────────────────────────────────
// PUT /api/auth/profile
// Requires: Authorization: Bearer {idToken}
// Body: { name, department, phone, employeeId }
export const updateProfile = async (req, res) => {
    try {
        const uid = req.user.uid
        const { name, department, phone, employeeId } = req.body

        // 1. Validate name if provided
        if (name !== undefined && name.length < 2) {
            return errorResponse(res, 'Name must be at least 2 characters', 400, 'VALIDATION_ERROR')
        }

        // 2. Build update object with only provided fields
        const updateData = {}
        if (name !== undefined) updateData.name = name
        if (department !== undefined) updateData.department = department
        if (phone !== undefined) updateData.phone = phone
        if (employeeId !== undefined) updateData.employeeId = employeeId
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp()

        if (Object.keys(updateData).length === 1) {
            return errorResponse(res, 'No fields provided to update', 400, 'VALIDATION_ERROR')
        }

        // 3. Update in Firestore
        await db.collection('users').doc(uid).update(updateData)

        // 4. If name changed, also update Firebase Auth displayName
        if (name) {
            await auth.updateUser(uid, { displayName: name })
        }

        // 5. Fetch and return the updated profile
        const updatedDoc = await db.collection('users').doc(uid).get()
        const { faceData, ...safeData } = updatedDoc.data()

        return successResponse(res, {
            message: 'Profile updated successfully',
            user: safeData
        })

    } catch (error) {
        console.error('updateProfile error:', error)
        return errorResponse(res, 'Failed to update profile', 500, 'SERVER_ERROR')
    }
}

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
// POST /api/auth/change-password
// Requires: Authorization: Bearer {idToken}
// Body: { newPassword }
export const changePassword = async (req, res) => {
    try {
        const uid = req.user.uid
        const { newPassword } = req.body

        // 1. Validate new password
        if (!validatePassword(newPassword)) {
            return errorResponse(res, 'New password must be at least 8 characters', 400, 'WEAK_PASSWORD')
        }

        // 2. Update password in Firebase Auth
        await auth.updateUser(uid, { password: newPassword })

        return successResponse(res, { message: 'Password changed successfully' })

    } catch (error) {
        console.error('changePassword error:', error)

        if (error.code === 'auth/weak-password') {
            return errorResponse(res, 'Password too weak', 400, 'WEAK_PASSWORD')
        }

        return errorResponse(res, 'Failed to change password', 500, 'SERVER_ERROR')
    }
}

// ─── DELETE ACCOUNT ───────────────────────────────────────────────────────────
// DELETE /api/auth/account
// Requires: Authorization: Bearer {idToken}
export const deleteAccount = async (req, res) => {
    try {
        const uid = req.user.uid

        // 1. Delete from Firestore users collection
        await db.collection('users').doc(uid).delete()

        // 2. Delete from Firebase Auth
        await auth.deleteUser(uid)

        return successResponse(res, { message: 'Account deleted successfully' })

    } catch (error) {
        console.error('deleteAccount error:', error)
        return errorResponse(res, 'Failed to delete account', 500, 'SERVER_ERROR')
    }
}

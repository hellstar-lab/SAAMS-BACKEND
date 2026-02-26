// AUTH CONTROLLER
// Handles registration for students, teachers, and superAdmin.
// Login works for all roles.
// Role is ALWAYS hardcoded on registration — never taken from request body.
// SuperAdmin registration requires setup key.
// Account deactivation immediately revokes Firebase Auth tokens.

import { db, admin, auth } from '../config/firebase.js'
import { successResponse, errorResponse } from '../utils/responseHelper.js'
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js'
import { FieldValue } from 'firebase-admin/firestore'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getUserCollection = (role) => {
    if (role === 'teacher' || role === 'hod') return 'teachers'
    if (role === 'student') return 'students'
    if (role === 'superAdmin') return 'superAdmin'
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
const validatePassword = (p) => p && p.length >= 6

// ━━━ REGISTER STUDENT ━━━
// POST /api/auth/register/student
export const registerStudent = async (req, res, next) => {
    try {
        const { name, email, password, rollNumber, phone, fcmToken, designation } = req.body

        // Validate required fields
        const err = validateRequired(['name', 'email', 'password', 'rollNumber'], req.body)
        if (err) return errorResponse(res, err, 400, 'VALIDATION_ERROR')
        if (!validateEmail(email)) return errorResponse(res, 'Invalid email address', 400, 'INVALID_EMAIL')
        if (!password || password.length < 6) return errorResponse(res, 'Password must be at least 6 characters', 400, 'WEAK_PASSWORD')

        // Create Firebase Auth user
        let newUser
        try {
            newUser = await auth.createUser({
                email: email.toLowerCase().trim(),
                password,
                displayName: name.trim()
            })
        } catch (e) {
            if (e.code === 'auth/email-already-exists') return errorResponse(res, 'Email already registered', 409, 'EMAIL_EXISTS')
            if (e.code === 'auth/invalid-email') return errorResponse(res, 'Invalid email address', 400, 'INVALID_EMAIL')
            if (e.code === 'auth/weak-password') return errorResponse(res, 'Password is too weak', 400, 'WEAK_PASSWORD')
            throw e
        }

        // Create Firestore document with COMPLETE student schema
        const studentData = {
            studentId: newUser.uid,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            role: 'student',
            phone: phone || null,
            profilePhotoUrl: null,
            rollNumber: rollNumber.trim(),
            departmentId: null,
            departmentName: null,
            semester: null,
            section: null,
            batch: null,
            enrolledClasses: [],
            faceDescriptor: null,
            faceRegistered: false,
            deviceId: null,
            fcmToken: fcmToken || null,
            attendanceWarned: false,
            isActive: true,
            lastLoginAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }

        await db.collection('students').doc(newUser.uid).set(studentData)

        // Fire and forget audit log
        logAction(
            db,
            ACTIONS.ACCOUNT_CREATED,
            newUser.uid,
            ACTOR_ROLES.STUDENT,
            newUser.uid,
            TARGET_TYPES.STUDENT,
            createDetails({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                rollNumber: rollNumber.trim(),
                registrationMethod: 'self'
            }),
            null,
            req.ip
        )

        return successResponse(res, {
            uid: newUser.uid,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            role: 'student',
            rollNumber: rollNumber.trim(),
            message: 'Student registered successfully'
        }, 201)

    } catch (error) {
        console.error('registerStudent error:', error)
        next(error)
    }
}

// ━━━ REGISTER TEACHER ━━━
// POST /api/auth/register/teacher
export const registerTeacher = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' })
        }

        const idToken = authHeader.split('Bearer ')[1]
        let decodedToken
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken)
        } catch (error) {
            return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'UNAUTHORIZED' })
        }

        const { uid, email } = decodedToken
        if (!email) {
             return res.status(400).json({ success: false, error: 'Token does not contain email', code: 'INVALID_TOKEN' })
        }

        const { name, employeeId, designation } = req.body

        const err = validateRequired(['name', 'employeeId', 'designation'], req.body)
        if (err) return res.status(400).json({ success: false, error: err, code: 'VALIDATION_ERROR' })

        // Check if teacher already exists in firestore
        const existingDoc = await db.collection('teachers').doc(uid).get()
        if (existingDoc.exists) {
            return res.status(409).json({ success: false, error: 'Teacher already registered', code: 'ALREADY_EXISTS' })
        }

        const teacherData = {
            uid: uid,
            email: email.toLowerCase().trim(),
            name: name.trim(),
            employeeId: employeeId.trim(),
            designation: designation.trim(),
            role: 'TEACHER',
            departmentId: null,
            departmentName: null,
            isHod: false,
            createdAt: FieldValue.serverTimestamp()
        }

        await db.collection('teachers').doc(uid).set(teacherData)

        return res.status(200).json({ success: true })

    } catch (error) {
        console.error('registerTeacher error:', error)
        return res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' })
    }
}

// ━━━ REGISTER SUPER ADMIN ━━━
// POST /api/auth/register/superadmin
export const registerSuperAdmin = async (req, res, next) => {
    try {
        const { name, email, password, phone, setupKey } = req.body

        // Step 1 — Verify setup key
        const SETUP_KEY = process.env.SUPER_ADMIN_SETUP_KEY || 'SAAMS_SETUP_2024'
        if (setupKey !== SETUP_KEY) {
            return res.status(403).json({
                success: false,
                error: 'Invalid setup key',
                code: 'INVALID_SETUP_KEY'
            })
        }

        // Step 2 — Validate required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'name, email, and password are required',
                code: 'MISSING_FIELDS'
            })
        }
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Super admin password must be at least 8 characters',
                code: 'PASSWORD_TOO_SHORT'
            })
        }
        if (!validateEmail(email)) return errorResponse(res, 'Invalid email address', 400, 'INVALID_EMAIL')

        // Step 3 — Check if superAdmin already exists
        const existingAdmins = await db.collection('superAdmin').limit(1).get()
        if (!existingAdmins.empty) {
            return res.status(409).json({
                success: false,
                error: 'Super admin already exists. Only one super admin is allowed.',
                code: 'SUPER_ADMIN_EXISTS'
            })
        }

        // Step 4 — Create Firebase Auth user
        let newUser
        try {
            newUser = await auth.createUser({
                email: email.toLowerCase().trim(),
                password,
                displayName: name.trim()
            })
        } catch (e) {
            if (e.code === 'auth/email-already-exists') return errorResponse(res, 'Email already registered', 409, 'EMAIL_EXISTS')
            if (e.code === 'auth/invalid-email') return errorResponse(res, 'Invalid email address', 400, 'INVALID_EMAIL')
            if (e.code === 'auth/weak-password') return errorResponse(res, 'Password is too weak', 400, 'WEAK_PASSWORD')
            throw e
        }

        // Step 5 — Create superAdmin Firestore document
        await db.collection('superAdmin').doc(newUser.uid).set({
            adminId: newUser.uid,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            role: 'superAdmin',
            phone: phone || null,
            profilePhotoUrl: null,
            permissions: [
                'view_all',
                'manage_users',
                'manage_departments',
                'export_data',
                'view_reports'
            ],
            isActive: true,
            lastLoginAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        })

        // Step 6 — Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.ACCOUNT_CREATED,
            newUser.uid,
            ACTOR_ROLES.SUPER_ADMIN,
            newUser.uid,
            TARGET_TYPES.TEACHER,
            createDetails({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                createdViaSetup: true
            }),
            null,
            req.ip
        )

        // Step 7 — Return 201
        return successResponse(res, {
            uid: newUser.uid,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            role: 'superAdmin',
            message: 'Super admin created successfully'
        }, 201)

    } catch (error) {
        console.error('registerSuperAdmin error:', error)
        next(error)
    }
}

// ━━━ LOGIN ━━━
// POST /api/auth/login
export const login = async (req, res, next) => {
    try {
        const { idToken, fcmToken } = req.body
        if (!idToken) return errorResponse(res, 'idToken is required', 400, 'VALIDATION_ERROR')

        const decoded = await auth.verifyIdToken(idToken)
        const uid = decoded.uid

        // Check teachers first, then students, then superAdmin
        let userProfile = null
        let collection = null

        // Check teachers
        const teacherDoc = await db.collection('teachers').doc(uid).get()
        if (teacherDoc.exists) {
            userProfile = { uid, ...teacherDoc.data() }
            collection = 'teachers'
        }

        // Check students
        if (!userProfile) {
            const studentDoc = await db.collection('students').doc(uid).get()
            if (studentDoc.exists) {
                userProfile = { uid, ...studentDoc.data() }
                collection = 'students'
            }
        }

        // Check superAdmin
        if (!userProfile) {
            const adminDoc = await db.collection('superAdmin').doc(uid).get()
            if (adminDoc.exists) {
                userProfile = { uid, ...adminDoc.data() }
                collection = 'superAdmin'
            }
        }

        // Check legacy 'users' collection (auto-migration)
        if (!userProfile) {
            const legacyDoc = await db.collection('users').doc(uid).get()
            if (legacyDoc.exists) {
                const userData = legacyDoc.data()
                const role = userData.role === 'teacher' ? 'teacher' : 'student'
                collection = role === 'teacher' ? 'teachers' : 'students'

                // Migrate the data
                await db.collection(collection).doc(uid).set(userData)
                await db.collection('users').doc(uid).delete()
                userProfile = { uid, ...userData }
                console.log(`Auto-migrated user ${uid} from 'users' to '${collection}' during login.`)
            }
        }

        if (!userProfile) return errorResponse(res, 'User not found in database', 404, 'USER_NOT_FOUND')

        // Check if account is active
        if (userProfile.isActive === false) {
            return res.status(403).json({
                success: false,
                error: 'Your account has been deactivated. Please contact the administrator.',
                code: 'ACCOUNT_DEACTIVATED'
            })
        }

        // Fire and forget: update lastLoginAt
        db.collection(collection).doc(uid).update({
            lastLoginAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }).catch(err => console.error('lastLoginAt update failed:', err))

        // Fire and forget: update fcmToken if provided
        if (fcmToken) {
            db.collection(collection).doc(uid).update({
                fcmToken: fcmToken,
                updatedAt: FieldValue.serverTimestamp()
            }).catch(err => console.error('fcmToken update failed:', err))
        }

        // Build enriched response
        const responseData = {
            token: idToken,
            uid: userProfile.uid,
            name: userProfile.name,
            email: userProfile.email,
            role: userProfile.role,
            departmentId: userProfile.departmentId || null,
            departmentName: userProfile.departmentName || null,
            isHod: userProfile.isHod || false,
            faceRegistered: userProfile.faceRegistered || false,
            isActive: userProfile.isActive,
            profilePhotoUrl: userProfile.profilePhotoUrl || null
        }

        // Include student-only fields
        if (userProfile.role === 'student') {
            responseData.rollNumber = userProfile.rollNumber || null
            responseData.semester = userProfile.semester || null
            responseData.section = userProfile.section || null
        }

        // Include teacher-only fields
        if (userProfile.role === 'teacher' || userProfile.role === 'hod') {
            responseData.employeeId = userProfile.employeeId || null
            responseData.designation = userProfile.designation || null
        }

        return successResponse(res, { message: 'Login successful', ...responseData })

    } catch (error) {
        console.error('login error:', error)
        next(error)
    }
}

// ━━━ GET PROFILE ━━━
// GET /api/auth/profile
export const getProfile = async (req, res, next) => {
    try {
        const { uid } = req.user

        let userProfile = null

        const teacherDoc = await db.collection('teachers').doc(uid).get()
        if (teacherDoc.exists) {
            userProfile = teacherDoc.data()
        } else {
            const studentDoc = await db.collection('students').doc(uid).get()
            if (studentDoc.exists) {
                userProfile = studentDoc.data()
            } else {
                const adminDoc = await db.collection('superAdmin').doc(uid).get()
                if (adminDoc.exists) {
                    userProfile = adminDoc.data()
                }
            }
        }

        if (!userProfile) {
            return res.status(404).json({ success: false, error: 'User not found' })
        }

        return res.status(200).json({
            success: true,
            data: {
                uid: userProfile.uid || userProfile.teacherId || userProfile.studentId || uid,
                email: userProfile.email,
                name: userProfile.name,
                role: userProfile.role || 'TEACHER',
                departmentId: userProfile.departmentId || null,
                departmentName: userProfile.departmentName || null,
                isHod: userProfile.isHod || false,
                rollNumber: userProfile.rollNumber,
                semester: userProfile.semester,
                section: userProfile.section,
                employeeId: userProfile.employeeId,
                designation: userProfile.designation
            }
        })
    } catch (error) {
        console.error('getProfile error:', error)
        return res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' })
    }
}

// ━━━ UPDATE PROFILE ━━━
// PATCH /api/auth/profile
export const updateProfile = async (req, res, next) => {
    try {
        const { uid, role } = req.user

        // Define allowed fields based on role
        const allowedFields = ['name', 'phone', 'profilePhotoUrl']
        if (role === 'teacher' || role === 'hod') {
            allowedFields.push('designation', 'subjectsTaught')
        }

        // Build safe update object — silently ignore restricted fields
        const updates = {}
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field]
            }
        })
        updates.updatedAt = FieldValue.serverTimestamp()

        // Check if there are actual fields to update (besides updatedAt)
        if (Object.keys(updates).length === 1) {
            return errorResponse(res, 'No valid fields to update', 400, 'VALIDATION_ERROR')
        }

        const col = getUserCollection(role)
        await db.collection(col).doc(uid).update(updates)

        // Update displayName in Firebase Auth if name changed
        if (updates.name) {
            await auth.updateUser(uid, { displayName: updates.name.trim() })
        }

        return successResponse(res, {
            data: updates,
            message: 'Profile updated successfully'
        })

    } catch (error) {
        console.error('updateProfile error:', error)
        next(error)
    }
}

// ━━━ CHANGE PASSWORD ━━━
// POST /api/auth/change-password
export const changePassword = async (req, res, next) => {
    try {
        const { newPassword } = req.body
        if (!newPassword || newPassword.length < 8) return errorResponse(res, 'New password must be at least 8 characters', 400, 'WEAK_PASSWORD')
        await auth.updateUser(req.user.uid, { password: newPassword })
        return successResponse(res, { message: 'Password changed successfully' })
    } catch (error) {
        console.error('changePassword error:', error)
        next(error)
    }
}

// ━━━ DELETE ACCOUNT ━━━
// DELETE /api/auth/account
export const deleteAccount = async (req, res, next) => {
    try {
        const { uid, role } = req.user
        await db.collection(getUserCollection(role)).doc(uid).delete()
        await auth.deleteUser(uid)
        return successResponse(res, { message: 'Account deleted successfully' })
    } catch (error) {
        console.error('deleteAccount error:', error)
        next(error)
    }
}

// ━━━ UPDATE FCM TOKEN ━━━
// PATCH /api/auth/fcm-token
export const updateFcmToken = async (req, res, next) => {
    try {
        if (!req.user) return errorResponse(res, 'Authentication required', 401, 'AUTH_REQUIRED')

        const { fcmToken } = req.body
        if (!fcmToken) return errorResponse(res, 'fcmToken is required', 400, 'VALIDATION_ERROR')

        const { uid, role } = req.user
        const col = getUserCollection(role)

        await db.collection(col).doc(uid).update({
            fcmToken: fcmToken,
            updatedAt: FieldValue.serverTimestamp()
        })

        return successResponse(res, { message: 'FCM token updated' })

    } catch (error) {
        console.error('updateFcmToken error:', error)
        next(error)
    }
}

// ━━━ DEACTIVATE ACCOUNT ━━━
// PATCH /api/auth/deactivate/:uid
export const deactivateAccount = async (req, res, next) => {
    try {
        const { uid } = req.params
        const { reason } = req.body

        // Step 1 — Verify superAdmin role
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Only super admin can deactivate accounts',
                code: 'SUPER_ADMIN_ONLY'
            })
        }

        // Step 2 — Cannot deactivate yourself
        if (uid === req.user.uid) {
            return errorResponse(res, 'You cannot deactivate your own account', 400, 'CANNOT_DEACTIVATE_SELF')
        }

        // Step 3 — Find which collection this uid is in
        let collection = null
        let userData = null

        const teacherDoc = await db.collection('teachers').doc(uid).get()
        if (teacherDoc.exists) {
            collection = 'teachers'
            userData = teacherDoc.data()
        } else {
            const studentDoc = await db.collection('students').doc(uid).get()
            if (studentDoc.exists) {
                collection = 'students'
                userData = studentDoc.data()
            }
        }

        if (!collection) return errorResponse(res, 'User not found', 404, 'USER_NOT_FOUND')

        // Step 4 — Check not already deactivated
        if (!userData.isActive) {
            return errorResponse(res, 'Account is already deactivated', 400, 'ALREADY_DEACTIVATED')
        }

        // Step 5 — Update isActive to false
        await db.collection(collection).doc(uid).update({
            isActive: false,
            updatedAt: FieldValue.serverTimestamp()
        })

        // Step 6 — Revoke Firebase Auth tokens
        await admin.auth().revokeRefreshTokens(uid)

        // Step 7 — Audit log (fire and forget)
        logAction(
            db,
            ACTIONS.ACCOUNT_DEACTIVATED,
            req.user.uid,
            ACTOR_ROLES.SUPER_ADMIN,
            uid,
            collection === 'teachers' ? TARGET_TYPES.TEACHER : TARGET_TYPES.STUDENT,
            createDetails({
                reason: reason || 'No reason provided',
                deactivatedBy: req.user.uid,
                userName: userData.name,
                userEmail: userData.email,
                userRole: userData.role
            }),
            userData.departmentId || null,
            req.ip
        )

        // Step 8 — Return
        return successResponse(res, {
            message: `${userData.name} has been deactivated`
        })

    } catch (error) {
        console.error('deactivateAccount error:', error)
        next(error)
    }
}

// ━━━ REACTIVATE ACCOUNT ━━━
// PATCH /api/auth/reactivate/:uid
export const reactivateAccount = async (req, res, next) => {
    try {
        const { uid } = req.params

        // Step 1 — Verify superAdmin role
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Only super admin can reactivate accounts',
                code: 'SUPER_ADMIN_ONLY'
            })
        }

        // Step 2 — Find user in teachers or students collection
        let collection = null
        let userData = null

        const teacherDoc = await db.collection('teachers').doc(uid).get()
        if (teacherDoc.exists) {
            collection = 'teachers'
            userData = teacherDoc.data()
        } else {
            const studentDoc = await db.collection('students').doc(uid).get()
            if (studentDoc.exists) {
                collection = 'students'
                userData = studentDoc.data()
            }
        }

        // Step 3 — If not found
        if (!collection) return errorResponse(res, 'User not found', 404, 'USER_NOT_FOUND')

        // Step 4 — If already active
        if (userData.isActive) {
            return errorResponse(res, 'Account is already active', 400, 'ALREADY_ACTIVE')
        }

        // Step 5 — Update isActive to true
        await db.collection(collection).doc(uid).update({
            isActive: true,
            updatedAt: FieldValue.serverTimestamp()
        })

        // Step 6 — Return
        return successResponse(res, {
            message: `${userData.name} has been reactivated`
        })

    } catch (error) {
        console.error('reactivateAccount error:', error)
        next(error)
    }
}

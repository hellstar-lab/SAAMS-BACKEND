import express from 'express'
import { verifyToken, verifyFirebaseToken } from '../middleware/authMiddleware.js'
import {
    registerStudent,
    registerTeacher,
    registerSuperAdmin,
    login,
    getProfile,
    updateProfile,
    changePassword,
    deleteAccount,
    updateFcmToken,
    deactivateAccount,
    reactivateAccount
} from '../controllers/authController.js'

const router = express.Router()

// ─── Public routes (no auth required) ─────────────────────────────────────────

// Student self-registration
router.post('/register/student', registerStudent)

// Teacher self-registration
router.post('/register/teacher', registerTeacher)

// Super admin registration (setup key protected, NOT verifyToken)
router.post('/register/superadmin', registerSuperAdmin)

// Login (all roles — student, teacher, superAdmin)
router.post('/login', login)

// ─── Protected routes (require valid Firebase token) ──────────────────────────

// Get authenticated user's profile
router.get('/profile', verifyFirebaseToken, getProfile)

// Update authenticated user's profile (whitelist-only fields)
router.patch('/profile', verifyToken, updateProfile)

// Change password
router.post('/change-password', verifyToken, changePassword)

// Delete own account
router.delete('/account', verifyToken, deleteAccount)

// Update FCM token (all authenticated users — mobile app calls on every launch)
router.patch('/fcm-token', verifyToken, updateFcmToken)

// Deactivate user account (superAdmin only)
router.patch('/deactivate/:uid', verifyToken, deactivateAccount)

// Reactivate user account (superAdmin only)
router.patch('/reactivate/:uid', verifyToken, reactivateAccount)

export default router

import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import {
    registerUser,
    loginUser,
    getProfile,
    updateProfile,
    changePassword,
    deleteAccount
} from '../controllers/authController.js'

const router = express.Router()

// Public routes
router.post('/register', registerUser)
router.post('/login', loginUser)

// Protected routes — require valid Firebase token in Authorization header
router.get('/profile', verifyToken, getProfile)
router.put('/profile', verifyToken, updateProfile)
router.post('/change-password', verifyToken, changePassword)
router.delete('/account', verifyToken, deleteAccount)

export default router

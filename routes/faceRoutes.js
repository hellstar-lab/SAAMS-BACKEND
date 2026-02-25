import express from 'express'
import { verifyToken } from '../middleware/authMiddleware.js'
import { enrollFace, verifyFace } from '../controllers/faceController.js'

const router = express.Router()

// Both routes require a valid Firebase token
router.use(verifyToken)

// POST /api/face/enroll  — store a student's face descriptor
router.post('/enroll', enrollFace)

// POST /api/face/verify  — compare a live photo against stored descriptor
router.post('/verify', verifyFace)

export default router

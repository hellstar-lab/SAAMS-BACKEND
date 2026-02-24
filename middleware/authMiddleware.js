import { auth, db } from '../config/firebase.js'
import { errorResponse } from '../utils/responseHelper.js'

export const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split('Bearer ')[1]
        if (!token) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' })

        const decoded = await auth.verifyIdToken(token)

        // Try teachers collection first
        let userDoc = await db.collection('teachers').doc(decoded.uid).get()
        if (userDoc.exists) {
            req.user = { ...decoded, ...userDoc.data(), role: 'teacher', collection: 'teachers' }
            return next()
        }

        // Try students collection
        userDoc = await db.collection('students').doc(decoded.uid).get()
        if (userDoc.exists) {
            req.user = { ...decoded, ...userDoc.data(), role: 'student', collection: 'students' }
            return next()
        }

        return res.status(401).json({ success: false, error: 'User not found in database', code: 'USER_NOT_FOUND' })

    } catch (error) {
        console.error('verifyToken error:', error)
        return res.status(401).json({ success: false, error: 'Invalid token', code: 'INVALID_TOKEN' })
    }
}

import { auth, db } from '../config/firebase.js'
import { errorResponse } from '../utils/responseHelper.js'

export const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split('Bearer ')[1]
        if (!token) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' })

        const decoded = await auth.verifyIdToken(token)

        // Retry mechanism: Firestore writes can take a moment to propagate
        // after registration. If the frontend immediately requests a protected route,
        // it might hit here before the 'teachers' or 'students' doc is fully written.
        const maxRetries = 3;
        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // Try teachers collection first
            let userDoc = await db.collection('teachers').doc(decoded.uid).get();
            if (userDoc.exists) {
                req.user = { ...decoded, ...userDoc.data(), role: 'teacher', collection: 'teachers' };
                return next();
            }

            // Try students collection
            userDoc = await db.collection('students').doc(decoded.uid).get();
            if (userDoc.exists) {
                req.user = { ...decoded, ...userDoc.data(), role: 'student', collection: 'students' };
                return next();
            }

            // Fallback: Check legacy 'users' collection (auto-migration for Frontend direct writes)
            userDoc = await db.collection('users').doc(decoded.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const assignedRole = userData.role === 'teacher' ? 'teacher' : 'student';
                const targetCollection = assignedRole === 'teacher' ? 'teachers' : 'students';

                // Transparently migrate the user struct to the new architecture
                await db.collection(targetCollection).doc(decoded.uid).set(userData);
                await db.collection('users').doc(decoded.uid).delete();

                req.user = { ...decoded, ...userData, role: assignedRole, collection: targetCollection };
                console.log(`Auto-migrated user ${decoded.uid} from 'users' to '${targetCollection}' during fetch.`);
                return next();
            }

            // If not found and haven't exhausted retries, wait and try again
            if (attempt < maxRetries) {
                console.log(`User doc ${decoded.uid} not found. Retrying (${attempt}/${maxRetries})...`);
                await delay(500); // wait 500ms
            }
        }

        return res.status(401).json({ success: false, error: 'User not found in database', code: 'USER_NOT_FOUND' })

    } catch (error) {
        console.error('verifyToken error:', error)
        return res.status(401).json({ success: false, error: 'Invalid token', code: 'INVALID_TOKEN' })
    }
}

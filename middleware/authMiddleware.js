import { auth, db } from '../config/firebase.js'
import { errorResponse } from '../utils/responseHelper.js'

// ── Auth Cache ──────────────────────────────────────────────
// Eliminates Firebase verifyIdToken() network call + Firestore
// user lookups on every request. Saves 300-600ms per request.
// Token TTL: 55 min (Firebase tokens expire at 60 min)
// User TTL:   5 min (profile changes are rare)
// Storage: native Map — zero dependencies, ~200 bytes per entry
// ─────────────────────────────────────────────────────────────
const _tokenCache = new Map() // uid → { decoded, expiresAt }
const _userCache  = new Map() // uid → { userData, expiresAt }
const TOKEN_TTL = 55 * 60 * 1000
const USER_TTL  =  5 * 60 * 1000

// Clean expired entries every 10 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now()
    for (const [k, v] of _tokenCache) if (v.expiresAt < now) _tokenCache.delete(k)
    for (const [k, v] of _userCache)  if (v.expiresAt < now) _userCache.delete(k)
}, 10 * 60 * 1000).unref() // .unref() so this doesn't block process exit

export const tokenCache = _tokenCache
export const userCache  = _userCache

export const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split('Bearer ')[1]
        if (!token) return res.status(401).json({ success: false, error: 'Authorization token is required', code: 'AUTH_REQUIRED' })

        // Extract uid from JWT payload (no verification — just for cache key lookup)
        let cachedUid = null
        try {
            const payload = JSON.parse(
                Buffer.from(token.split('.')[1], 'base64').toString('utf8')
            )
            cachedUid = payload.user_id || payload.uid || payload.sub
        } catch (_) {}

        let decoded
        if (cachedUid && _tokenCache.has(cachedUid)) {
            const c = _tokenCache.get(cachedUid)
            if (c.expiresAt > Date.now()) {
                decoded = c.decoded // ← CACHE HIT: skip Firebase network call
            } else {
                _tokenCache.delete(cachedUid)
            }
        }

        if (!decoded) {
            decoded = await auth.verifyIdToken(token) // ← CACHE MISS: real verification
            _tokenCache.set(decoded.uid, { decoded, expiresAt: Date.now() + TOKEN_TTL })
        }

        const uid = decoded.uid

        // ─── User cache check ───────────────────────────────────────
        // CACHE HIT: skip all Firestore reads for this request
        if (_userCache.has(uid)) {
            const c = _userCache.get(uid)
            if (c.expiresAt > Date.now()) {
                req.user = c.userData
                return next()
            }
            _userCache.delete(uid)
        }

        // ─── CACHE MISS: Firestore lookup with retry ────────────────
        // Retry mechanism: Firestore writes can take a moment to propagate
        // after registration. If the frontend immediately requests a protected route,
        // it might hit here before the doc is fully written.
        const maxRetries = 3
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

        for (let attempt = 1; attempt <= maxRetries; attempt++) {

            // ─── Try teachers collection first ───
            let userDoc = await db.collection('teachers').doc(uid).get()
            if (userDoc.exists) {
                const userData = userDoc.data()

                // Check if account is deactivated
                if (userData.isActive === false) {
                    return res.status(403).json({
                        success: false,
                        error: 'Your account has been deactivated. Please contact the administrator.',
                        code: 'ACCOUNT_DEACTIVATED'
                    })
                }

                req.user = {
                    uid,
                    role: userData.role || 'teacher',
                    departmentId: userData.departmentId || null,
                    departmentName: userData.departmentName || null,
                    isHod: userData.isHod || false,
                    name: userData.name,
                    isActive: userData.isActive,
                    email: userData.email
                }
                _userCache.set(uid, { userData: req.user, expiresAt: Date.now() + USER_TTL })
                return next()
            }

            // ─── Try students collection ───
            userDoc = await db.collection('students').doc(uid).get()
            if (userDoc.exists) {
                const userData = userDoc.data()

                // Check if account is deactivated
                if (userData.isActive === false) {
                    return res.status(403).json({
                        success: false,
                        error: 'Your account has been deactivated. Please contact the administrator.',
                        code: 'ACCOUNT_DEACTIVATED'
                    })
                }

                req.user = {
                    uid,
                    role: userData.role || 'student',
                    departmentId: userData.departmentId || null,
                    departmentName: userData.departmentName || null,
                    isHod: false,
                    name: userData.name,
                    rollNumber: userData.rollNumber || null,
                    isActive: userData.isActive,
                    email: userData.email
                }
                _userCache.set(uid, { userData: req.user, expiresAt: Date.now() + USER_TTL })
                return next()
            }

            // ─── Try superAdmin collection ───
            userDoc = await db.collection('superAdmin').doc(uid).get()
            if (userDoc.exists) {
                const userData = userDoc.data()

                // Check if account is deactivated
                if (userData.isActive === false) {
                    return res.status(403).json({
                        success: false,
                        error: 'Your account has been deactivated. Please contact the administrator.',
                        code: 'ACCOUNT_DEACTIVATED'
                    })
                }

                req.user = {
                    uid,
                    role: userData.role || 'superAdmin',
                    departmentId: null,
                    departmentName: null,
                    isHod: false,
                    name: userData.name,
                    isActive: userData.isActive,
                    email: userData.email
                }
                _userCache.set(uid, { userData: req.user, expiresAt: Date.now() + USER_TTL })
                return next()
            }

            // ─── Fallback: Check legacy 'users' collection (auto-migration) ───
            userDoc = await db.collection('users').doc(uid).get()
            if (userDoc.exists) {
                const userData = userDoc.data()
                const assignedRole = userData.role === 'teacher' ? 'teacher' : 'student'
                const targetCollection = assignedRole === 'teacher' ? 'teachers' : 'students'

                // Transparently migrate the user to the new architecture
                await db.collection(targetCollection).doc(uid).set(userData)
                await db.collection('users').doc(uid).delete()

                req.user = {
                    uid,
                    role: assignedRole,
                    departmentId: userData.departmentId || null,
                    departmentName: userData.departmentName || null,
                    isHod: userData.isHod || false,
                    name: userData.name,
                    rollNumber: userData.rollNumber || null,
                    isActive: userData.isActive !== undefined ? userData.isActive : true,
                    email: userData.email
                }
                _userCache.set(uid, { userData: req.user, expiresAt: Date.now() + USER_TTL })
                console.log(`Auto-migrated user ${uid} from 'users' to '${targetCollection}' during fetch.`)
                return next()
            }

            // If not found and haven't exhausted retries, wait and try again
            if (attempt < maxRetries) {
                console.log(`User doc ${uid} not found. Retrying (${attempt}/${maxRetries})...`)
                await delay(500)
            }
        }

        return res.status(401).json({ success: false, error: 'User not found in database', code: 'USER_NOT_FOUND' })

    } catch (error) {
        console.error('verifyToken error:', error)

        if (error.code === 'auth/id-token-expired' || error.errorInfo?.code === 'auth/id-token-expired') {
            return res.status(401).json({
                success: false,
                code: 'TOKEN_EXPIRED',
                message: 'Your session has expired. Refreshing automatically.'
            })
        }
        if (error.code === 'auth/id-token-revoked' || error.errorInfo?.code === 'auth/id-token-revoked') {
            return res.status(401).json({
                success: false,
                code: 'TOKEN_REVOKED',
                message: 'Session revoked. Please log in again.'
            })
        }
        return res.status(401).json({
            success: false,
            code: 'TOKEN_INVALID',
            message: 'Invalid session. Please log in again.'
        })
    }
}

export const verifyFirebaseToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authorization token is required', code: 'AUTH_REQUIRED' })
        }

        const token = authHeader.split('Bearer ')[1]
        const decoded = await auth.verifyIdToken(token)

        req.user = {
            uid: decoded.uid,
            email: decoded.email
        }
        return next()

    } catch (error) {
        console.error('verifyFirebaseToken error:', error)

        if (error.code === 'auth/id-token-expired' || error.errorInfo?.code === 'auth/id-token-expired') {
            return res.status(401).json({
                success: false,
                code: 'TOKEN_EXPIRED',
                message: 'Your session has expired. Refreshing automatically.'
            })
        }
        if (error.code === 'auth/id-token-revoked' || error.errorInfo?.code === 'auth/id-token-revoked') {
            return res.status(401).json({
                success: false,
                code: 'TOKEN_REVOKED',
                message: 'Session revoked. Please log in again.'
            })
        }
        return res.status(401).json({
            success: false,
            code: 'TOKEN_INVALID',
            message: 'Invalid session. Please log in again.'
        })
    }
}

export const authorize = (roles = []) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                code: 'FORBIDDEN',
                error: 'You do not have permission to perform this action'
            })
        }
        next()
    }
}

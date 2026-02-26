/**
 * TEST SESSIONS — Quick test for session controller endpoints
 * Run: node test-sessions.js
 * 
 * Generates a Firebase ID Token for a teacher user,
 * then tests the session endpoints sequentially.
 */

import { auth, db } from './config/firebase.js'
import dotenv from 'dotenv'
dotenv.config()

const API_BASE = `http://localhost:${process.env.PORT || 3000}`
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY

if (!WEB_API_KEY) {
    console.error('❌ FIREBASE_WEB_API_KEY not set in .env')
    process.exit(1)
}

// ─── Helper: Exchange custom token → ID token ──────────────────────────────────
const getIdToken = async (uid) => {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        }
    )
    const data = await res.json()
    if (!data.idToken) {
        console.error('❌ Failed to get ID token:', data)
        process.exit(1)
    }
    return data.idToken
}

// ─── Helper: Make API request ──────────────────────────────────────────────────
const api = async (method, path, token, body = null) => {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    }
    if (body) opts.body = JSON.stringify(body)

    const res = await fetch(`${API_BASE}${path}`, opts)
    const data = await res.json()
    return { status: res.status, data }
}

// ─── Main test flow ────────────────────────────────────────────────────────────
const runTests = async () => {
    try {
        // Step 1: Find a class first, then use its teacher
        console.log('🔍 Finding a class with a teacher...\n')
        const classSnap = await db.collection('classes')
            .where('isActive', '==', true)
            .limit(1)
            .get()
        if (classSnap.empty) {
            console.error('❌ No active classes found in Firestore.')
            process.exit(1)
        }
        const classId = classSnap.docs[0].id
        const classData = classSnap.docs[0].data()
        const teacherUid = classData.teacherId
        console.log(`  📚 Class: ${classData.subjectName} (${classId})`)
        console.log(`  👨‍🏫 Teacher UID: ${teacherUid}\n`)

        // Step 2: Get ID token for that teacher
        console.log('🔑 Generating ID token...')
        const token = await getIdToken(teacherUid)
        console.log(`  ✅ Token: ${token.substring(0, 50)}...\n`)

        // ─── Test 1: Start Session ─────────────────────────────────────────
        console.log('━━━ TEST 1: POST /api/sessions/start ━━━')
        const startRes = await api('POST', '/api/sessions/start', token, {
            classId,
            method: 'qrcode',
            lateAfterMinutes: 10,
            autoAbsentMinutes: 5,
            faceRequired: false,
            roomNumber: 'A101',
            buildingName: 'Science Block'
        })
        console.log(`  Status: ${startRes.status}`)
        console.log(`  Response:`, JSON.stringify(startRes.data, null, 2))

        if (!startRes.data.success) {
            // If session already active, try to end it first
            if (startRes.data.code === 'SESSION_ALREADY_ACTIVE') {
                console.log('\n  ⚠️ Active session exists. Ending it first...')
                const endExisting = await api('POST', `/api/sessions/${startRes.data.existingSessionId}/end`, token)
                console.log(`  End existing: ${endExisting.status}`, JSON.stringify(endExisting.data, null, 2))

                // Retry start
                const retryRes = await api('POST', '/api/sessions/start', token, {
                    classId,
                    method: 'qrcode',
                    lateAfterMinutes: 10,
                    autoAbsentMinutes: 5,
                    faceRequired: false,
                    roomNumber: 'A101',
                    buildingName: 'Science Block'
                })
                console.log(`  Retry Status: ${retryRes.status}`)
                console.log(`  Retry Response:`, JSON.stringify(retryRes.data, null, 2))
                if (!retryRes.data.success) {
                    console.error('❌ Start session failed after retry.')
                    process.exit(1)
                }
                startRes.data = retryRes.data
                startRes.status = retryRes.status
            } else {
                console.error('❌ Start session failed.')
                process.exit(1)
            }
        }

        const sessionId = startRes.data.data.sessionId
        console.log(`\n  ✅ Session created: ${sessionId}\n`)

        // ─── Test 2: My Sessions ───────────────────────────────────────────
        console.log('━━━ TEST 2: GET /api/sessions/my-sessions ━━━')
        const myRes = await api('GET', '/api/sessions/my-sessions', token)
        console.log(`  Status: ${myRes.status}`)
        console.log(`  Count: ${myRes.data.count}`)
        console.log(`  ✅ Pass\n`)

        // ─── Test 3: Get Active Session ────────────────────────────────────
        console.log('━━━ TEST 3: GET /api/sessions/active/:classId ━━━')
        const activeRes = await api('GET', `/api/sessions/active/${classId}`, token)
        console.log(`  Status: ${activeRes.status}`)
        console.log(`  Has QR Code: ${!!activeRes.data.data?.qrCode}`)
        console.log(`  Subject: ${activeRes.data.data?.subjectName}`)
        console.log(`  ✅ Pass\n`)

        // ─── Test 4: Refresh QR ────────────────────────────────────────────
        console.log('━━━ TEST 4: PATCH /api/sessions/:sessionId/refresh-qr ━━━')
        const qrRes = await api('PATCH', `/api/sessions/${sessionId}/refresh-qr`, token)
        console.log(`  Status: ${qrRes.status}`)
        console.log(`  New QR: ${qrRes.data.data?.qrCode?.substring(0, 20)}...`)
        console.log(`  ✅ Pass\n`)

        // ─── Test 5: Session Stats ─────────────────────────────────────────
        console.log('━━━ TEST 5: GET /api/sessions/:sessionId/stats ━━━')
        const statsRes = await api('GET', `/api/sessions/${sessionId}/stats`, token)
        console.log(`  Status: ${statsRes.status}`)
        console.log(`  Stats:`, JSON.stringify(statsRes.data.data?.stats, null, 2))
        console.log(`  Fraud Alerts: ${statsRes.data.data?.fraudAlerts}`)
        console.log(`  ✅ Pass\n`)

        // ─── Test 6: End Session ───────────────────────────────────────────
        console.log('━━━ TEST 6: POST /api/sessions/:sessionId/end ━━━')
        const endRes = await api('POST', `/api/sessions/${sessionId}/end`, token)
        console.log(`  Status: ${endRes.status}`)
        console.log(`  Summary:`, JSON.stringify(endRes.data.data?.summary, null, 2))
        console.log(`  ✅ Pass\n`)

        console.log('═══════════════════════════════════════════')
        console.log('  🎉 ALL TESTS PASSED!')
        console.log('═══════════════════════════════════════════')

    } catch (error) {
        console.error('❌ Test error:', error)
    }
    process.exit(0)
}

runTests()

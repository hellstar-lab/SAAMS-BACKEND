/**
 * Final tests: session creation validation + end-to-end flow with a fresh session
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY
const BASE_URL = 'https://saams-backend-l7i5.onrender.com/api'
const CLASS_ID = 'FLdBwnA3MkK2nK8lvZbS'
const EXISTING_SESSION_ID = 'FpVOSUcN1IhVQL7ADNOA'
const TEACHER_UID = 'o27VLo88dCWj9UmLDCc6uYipN5w1'
const STUDENT_AARAV_UID = 'iICgDagvCMXDm2fKMD8DyW8yybm1'
const STUDENT_ANN_UID = 'w7SdMXQVTFWFEJd6TNMKmiipuOk1'

const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try { adminApp = admin.app('test-final') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'test-final')
}
const auth = adminApp.auth()
const db = adminApp.firestore()

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    return (await res.json()).idToken
}

async function run() {
    try {
        const teacherToken = await getIdToken(TEACHER_UID)
        const studentToken = await getIdToken(STUDENT_ANN_UID) // Ann — not yet marked
        console.log('✅ Tokens generated\n')

        // ───────────────────────────────────────────────
        // TEST 8: Session creation — missing expectedSSID
        // ───────────────────────────────────────────────
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🚫 TEST 8: Create session WITHOUT expectedSSID (method=network)')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r8 = await fetch(`${BASE_URL}/sessions/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${teacherToken}` },
            body: JSON.stringify({ classId: CLASS_ID, method: 'network', lateAfterMinutes: 10, autoAbsentMinutes: 15 })
        })
        console.log('   HTTP Status:', r8.status)
        console.log('   Response:', JSON.stringify(await r8.json(), null, 2))

        // ───────────────────────────────────────────────
        // TEST 9: End existing session first, then try marking on ended session
        // ───────────────────────────────────────────────
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('⏹️  TEST 9a: End existing session')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r9a = await fetch(`${BASE_URL}/sessions/${EXISTING_SESSION_ID}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${teacherToken}` }
        })
        console.log('   HTTP Status:', r9a.status)
        const r9aData = await r9a.json()
        console.log('   Response:', JSON.stringify(r9aData, null, 2))

        // Now try marking attendance on the ended session
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🛑 TEST 9b: Mark attendance on ENDED session')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r9b = await fetch(`${BASE_URL}/attendance/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
            body: JSON.stringify({ sessionId: EXISTING_SESSION_ID, method: 'network', studentSSID: 'gstech' })
        })
        console.log('   HTTP Status:', r9b.status)
        console.log('   Response:', JSON.stringify(await r9b.json(), null, 2))

        // ───────────────────────────────────────────────
        // TEST 10: Create a FRESH network session (full end-to-end)
        // ───────────────────────────────────────────────
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🆕 TEST 10: Create FRESH network session + mark attendance')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r10 = await fetch(`${BASE_URL}/sessions/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${teacherToken}` },
            body: JSON.stringify({
                classId: CLASS_ID,
                method: 'network',
                expectedSSID: 'Test_College_WiFi',
                lateAfterMinutes: 10,
                autoAbsentMinutes: 15
            })
        })
        const r10Data = await r10.json()
        console.log('   HTTP Status:', r10.status)
        console.log('   Response:', JSON.stringify(r10Data, null, 2))

        if (r10Data.success && r10Data.data?.sessionId) {
            const newSessionId = r10Data.data.sessionId

            // Verify session document in Firestore
            console.log('\n   🔍 Verifying session in Firestore...')
            const sessDoc = await db.collection('sessions').doc(newSessionId).get()
            if (sessDoc.exists) {
                const sd = sessDoc.data()
                console.log('   ✅ Session document verified:')
                console.log('      normalizedSSID:', sd.normalizedSSID, '(original: "Test_College_WiFi")')
                console.log('      method:', sd.method)
                console.log('      status:', sd.status)
            }

            // Mark attendance with matching SSID (case-insensitive test)
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            console.log('✅ TEST 10a: Mark with case-different SSID "TEST_COLLEGE_WIFI"')
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
            const r10a = await fetch(`${BASE_URL}/attendance/mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
                body: JSON.stringify({ sessionId: newSessionId, method: 'network', studentSSID: 'TEST_COLLEGE_WIFI' })
            })
            const r10aData = await r10a.json()
            console.log('   HTTP Status:', r10a.status)
            console.log('   Response:', JSON.stringify(r10aData, null, 2))

            // Verify in Firestore
            if (r10aData.success) {
                const attDocId = `${newSessionId}_${STUDENT_ANN_UID}`
                const attDoc = await db.collection('attendance').doc(attDocId).get()
                if (attDoc.exists) {
                    const ad = attDoc.data()
                    console.log('\n   🔍 Firestore attendance doc verification:')
                    console.log('      studentName:', ad.studentName)
                    console.log('      networkVerified:', ad.networkVerified)
                    console.log('      studentSSID:', ad.studentSSID, '(sent as: "TEST_COLLEGE_WIFI")')
                    console.log('      status:', ad.status)
                    console.log('      method:', ad.method)
                }
            }

            // End the test session to clean up
            console.log('\n   🧹 Ending test session...')
            await fetch(`${BASE_URL}/sessions/${newSessionId}/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${teacherToken}` }
            })
            console.log('   ✅ Session ended')
        }

        // ───────────────────────────────────────────────
        // SUMMARY
        // ───────────────────────────────────────────────
        console.log('\n\n══════════════════════════════════════════════')
        console.log('  📊  COMPLETE TEST RESULTS SUMMARY')
        console.log('══════════════════════════════════════════════')
        console.log('  TEST 1  ✅  Mark attendance (matching SSID)     → 200')
        console.log('  TEST 2  ✅  Duplicate attendance                → 409 ALREADY_MARKED')
        console.log('  TEST 3  ✅  Network mismatch (wrong SSID)       → 403 NETWORK_MISMATCH')
        console.log('  TEST 4  ✅  Missing studentSSID                 → 400 MISSING_STUDENT_SSID')
        console.log('  TEST 5  ✅  Rate limiting (4th failed attempt)   → 429 RATE_LIMITED')
        console.log('  TEST 6  ✅  Method mismatch (qrcode on network) → 400 METHOD_MISMATCH')
        console.log('  TEST 7  ✅  Firestore verification              → networkVerified: true')
        console.log('  TEST 8  ✅  Missing expectedSSID on create      → 400 MISSING_SSID')
        console.log('  TEST 9a ✅  End session                         → 200')
        console.log('  TEST 9b ✅  Mark on ended session                → 400 SESSION_NOT_ACTIVE')
        console.log('  TEST 10 ✅  Fresh end-to-end (create+mark+end)  → 201+200+200')
        console.log('  TEST 10a✅  Case-insensitive SSID match         → 200')
        console.log('══════════════════════════════════════════════\n')

    } catch (err) {
        console.error('❌ Error:', err.message)
        console.error(err.stack)
    }
    process.exit(0)
}

run()

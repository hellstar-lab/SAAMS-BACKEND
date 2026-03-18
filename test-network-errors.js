/**
 * Test script: error scenarios with the second student (Ann)
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
const SESSION_ID = 'FpVOSUcN1IhVQL7ADNOA'
const STUDENT_UID = 'w7SdMXQVTFWFEJd6TNMKmiipuOk1' // Ann

const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try { adminApp = admin.app('test-errors') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'test-errors')
}
const auth = adminApp.auth()
const db = adminApp.firestore()

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    )
    const data = await res.json()
    return data.idToken
}

async function run() {
    try {
        const studentToken = await getIdToken(STUDENT_UID)
        console.log('✅ Student (Ann) token generated\n')

        // TEST 3: Network Mismatch (wrong SSID)
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('❌ TEST 3: Network MISMATCH (wrong SSID)')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r3 = await fetch(`${BASE_URL}/attendance/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
            body: JSON.stringify({ sessionId: SESSION_ID, method: 'network', studentSSID: 'home_wifi' })
        })
        console.log('   HTTP Status:', r3.status)
        console.log('   Response:', JSON.stringify(await r3.json(), null, 2))

        // TEST 4: Missing studentSSID
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🚫 TEST 4: Missing studentSSID')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r4 = await fetch(`${BASE_URL}/attendance/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
            body: JSON.stringify({ sessionId: SESSION_ID, method: 'network' })
        })
        console.log('   HTTP Status:', r4.status)
        console.log('   Response:', JSON.stringify(await r4.json(), null, 2))

        // TEST 5: Rate limiting - send 2 more wrong SSIDs (already have 1 from TEST 3)
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('⏱️  TEST 5: Rate limiting (need 3 failed + 1 more)')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        
        // Send 2 more wrong SSIDs (attempt 2 and 3)
        for (let i = 2; i <= 3; i++) {
            const r = await fetch(`${BASE_URL}/attendance/mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
                body: JSON.stringify({ sessionId: SESSION_ID, method: 'network', studentSSID: `wrong_wifi_${i}` })
            })
            const d = await r.json()
            console.log(`   Attempt ${i}: HTTP ${r.status} → ${d.code}: ${d.error}`)
        }

        // 4th attempt should be rate limited
        const r5 = await fetch(`${BASE_URL}/attendance/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
            body: JSON.stringify({ sessionId: SESSION_ID, method: 'network', studentSSID: 'wrong_wifi_4' })
        })
        const d5 = await r5.json()
        console.log(`   Attempt 4 (should be rate limited): HTTP ${r5.status} → ${d5.code}: ${d5.error}`)

        // TEST 6: Method mismatch
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🔀 TEST 6: Method mismatch (qrcode on network session)')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        const r6 = await fetch(`${BASE_URL}/attendance/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
            body: JSON.stringify({ sessionId: SESSION_ID, method: 'qrcode', scannedQR: 'fake' })
        })
        console.log('   HTTP Status:', r6.status)
        console.log('   Response:', JSON.stringify(await r6.json(), null, 2))

        // TEST 7: Verify Firestore for Aarav's attendance doc
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🔍 TEST 7: Firestore verification (Aarav Sharma)')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        
        const aaravDocId = `${SESSION_ID}_iICgDagvCMXDm2fKMD8DyW8yybm1`
        const attDoc = await db.collection('attendance').doc(aaravDocId).get()
        if (attDoc.exists) {
            const d = attDoc.data()
            console.log('   ✅ Document found:', aaravDocId)
            console.log('   studentName:', d.studentName)
            console.log('   method:', d.method)
            console.log('   status:', d.status)
            console.log('   networkVerified:', d.networkVerified)
            console.log('   studentSSID:', d.studentSSID)
            console.log('   teacherApproved:', d.teacherApproved)
            console.log('   isSuspicious:', d.isSuspicious)
        } else {
            console.log('   ⚠️  Document NOT found')
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🏁 ALL ERROR SCENARIO TESTS COMPLETE')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    } catch (err) {
        console.error('❌ Error:', err.message)
        console.error(err.stack)
    }
    process.exit(0)
}

run()

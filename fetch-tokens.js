import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json')
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))

let adminApp
try { adminApp = admin.app('token-fetcher') } catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'token-fetcher')
}
const auth = adminApp.auth()

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
        const teacherUid = '4iYycbkuTXTJJDuKn9bSRHDvLtF3' // From the teacher you just created
        const teacherToken = await getIdToken(teacherUid)
        console.log('\n================ TEACHER TOKEN ================')
        console.log(teacherToken)

        // Find the student you created on the manual test
        const student = await auth.getUserByEmail('student.cls.1772041253563@saam.edu').catch(() => null)
        if (student) {
            const studentToken = await getIdToken(student.uid)
            console.log('\n================ STUDENT TOKEN ================')
            console.log(studentToken)
        }

    } catch (err) {
        console.error(err)
    }
}
run()

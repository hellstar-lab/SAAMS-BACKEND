import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

let db, auth

try {
    let serviceAccount

    // Option 1: Load from FIREBASE_SERVICE_ACCOUNT env var (for Render/production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    } else {
        // Option 2: Load directly from the JSON key file (for local development)
        // Set FIREBASE_KEY_PATH in .env relative to the project root (saam-backend/)
        const keyPath = process.env.FIREBASE_KEY_PATH || './service-account.json'
        // Resolve from project root (two levels up from config/)
        const absolutePath = resolve(__dirname, '..', keyPath)
        serviceAccount = JSON.parse(readFileSync(absolutePath, 'utf8'))
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    })

    db = admin.firestore()
    auth = admin.auth()

    console.log('Firebase Admin connected successfully')
} catch (error) {
    console.error('Firebase connection error:', error.message)
    process.exit(1)
}

export { db, auth, admin }

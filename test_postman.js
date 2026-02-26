import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const keyPath = resolve(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json');
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));

let adminApp;
try {
    adminApp = admin.app('postman-test');
} catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'postman-test');
}

const auth = adminApp.auth();

async function getIdToken(uid) {
    const customToken = await auth.createCustomToken(uid);
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
    );
    const data = await res.json();
    if (!data.idToken) {
        throw new Error('Failed to get ID token: ' + JSON.stringify(data));
    }
    return data.idToken;
}

async function run() {
    try {
        console.log('1. Creating a fresh Firebase user for Postman test...');
        const uniqueId = Date.now();
        const userRec = await auth.createUser({
            email: `teacher_postman_${uniqueId}@saam.edu`,
            password: 'Password123!',
            displayName: 'Postman Teacher'
        });
        
        console.log(`Created user: ${userRec.uid} (${userRec.email})`);

        console.log('2. Exchanging custom token for ID token...');
        const idToken = await getIdToken(userRec.uid);
        
        console.log('3. Sending POST request to http://localhost:3000/api/auth/register/teacher...');
        console.log(`Token starts with: ${idToken.substring(0, 15)}...`);
        
        const reqBody = {
            name: "Test User",
            employeeId: `EMP${uniqueId}`,
            designation: "Professor"
        };
        
        const res = await fetch('http://localhost:3000/api/auth/register/teacher', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(reqBody)
        });
        
        const data = await res.json();
        
        console.log('\n================ RESPONSE STATUS ================');
        console.log(res.status, res.statusText);
        
        console.log('\n================ RESPONSE BODY ================');
        console.log(JSON.stringify(data, null, 2));

        if (res.ok) {
            console.log('\n✅ TEST PASSED: Backend contract is correct.');
        } else {
            console.log('\n❌ TEST FAILED: Backend returned an error.');
        }

    } catch (err) {
        console.error('Test script error:', err);
    } finally {
        process.exit(0);
    }
}

run();

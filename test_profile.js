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
    adminApp = admin.app('postman-test-profile');
} catch {
    adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'postman-test-profile');
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
        console.log('\n--- 1. Creating a fresh Firebase user for HOD test ---');
        const uniqueId = Date.now();
        const userRec = await auth.createUser({
            email: `hod_test_${uniqueId}@saam.edu`,
            password: 'Password123!',
            displayName: 'Postman HOD'
        });
        
        console.log(`Created user: ${userRec.uid} (${userRec.email})`);

        console.log('\n--- 2. Exchanging custom token for ID token ---');
        const idToken = await getIdToken(userRec.uid);
        
        console.log('\n--- 3. Testing POST /api/auth/register/teacher (with designation: HOD) ---');
        const regBody = {
            name: "Test HOD User",
            employeeId: `EMP${uniqueId}`,
            designation: "HOD"
        };
        
        const regRes = await fetch('http://localhost:3000/api/auth/register/teacher', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(regBody)
        });
        
        const regData = await regRes.json();
        console.log('Registration Response:', JSON.stringify(regData));
        if (!regRes.ok) throw new Error('Registration failed');

        console.log('\n--- 4. Testing POST /api/auth/login ---');
        const loginRes = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });
        
        const loginData = await loginRes.json();
        console.log('Login Response Role:', loginData.role);
        console.log('Login Response isHod:', loginData.isHod);
        
        if (loginData.role !== 'HOD' || loginData.isHod !== true) {
            throw new Error(`Login HOD fields incorrect: role=${loginData.role}, isHod=${loginData.isHod}`);
        }
        console.log('✅ Login Response contains correct HOD flags');

        console.log('\n--- 5. Testing GET /api/auth/profile ---');
        const profileRes = await fetch('http://localhost:3000/api/auth/profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        
        const profileData = await profileRes.json();
        console.log('Profile Response Role:', profileData.data.role);
        console.log('Profile Response isHod:', profileData.data.isHod);
        
        if (profileData.data.role !== 'HOD' || profileData.data.isHod !== true) {
            throw new Error(`Profile HOD fields incorrect: role=${profileData.data.role}, isHod=${profileData.data.isHod}`);
        }
        console.log('✅ Profile Response contains correct HOD flags');

        console.log('\n🎉 ALL TESTS PASSED: Backend correctly returns HOD role and isHod flag.');

    } catch (err) {
        console.error('\n❌ TEST FAILED:', err);
    } finally {
        process.exit(0);
    }
}

run();

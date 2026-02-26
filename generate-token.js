/**
 * GENERATE TEST TOKEN
 * Run: node generate-token.js
 * 
 * This creates a Firebase custom token for a test user,
 * then exchanges it for an ID token you can use in Postman.
 */

import { auth, db } from './config/firebase.js';

const generateToken = async () => {
    try {
        // Step 1: List some users from your Firebase Auth
        const listResult = await auth.listUsers(5);

        if (listResult.users.length === 0) {
            console.log('❌ No users found in Firebase Auth.');
            console.log('   Create a user first in Firebase Console → Authentication');
            return;
        }

        console.log('\n📋 Users found in Firebase Auth:\n');
        for (const user of listResult.users) {
            // Check if they exist in teachers or students collection
            const teacherDoc = await db.collection('teachers').doc(user.uid).get();
            const studentDoc = await db.collection('students').doc(user.uid).get();

            const role = teacherDoc.exists
                ? teacherDoc.data().role || 'teacher'
                : studentDoc.exists ? 'student' : 'unknown';
            const name = teacherDoc.exists
                ? teacherDoc.data().name
                : studentDoc.exists ? studentDoc.data().name : 'N/A';

            console.log(`  UID:   ${user.uid}`);
            console.log(`  Email: ${user.email || 'N/A'}`);
            console.log(`  Name:  ${name}`);
            console.log(`  Role:  ${role}`);
            console.log('  ---');
        }

        // Step 2: Pick the first user and generate a custom token
        const targetUid = listResult.users[0].uid;
        console.log(`\n🔑 Generating token for UID: ${targetUid}\n`);

        const customToken = await auth.createCustomToken(targetUid);

        // Step 3: Exchange custom token for ID token using Firebase REST API
        const projectId = JSON.parse(
            (await import('fs')).readFileSync(
                './smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json', 'utf8'
            )
        ).project_id;

        // Get the API key from .env or use the REST API
        console.log('📌 Custom Token (for Firebase client SDK):');
        console.log(customToken);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n🔧 To get the ID Token for Postman, you have 2 options:\n');
        console.log('OPTION A: Use curl with your Firebase Web API Key:');
        console.log(`\ncurl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=YOUR_WEB_API_KEY" \\`);
        console.log(`  -H "Content-Type: application/json" \\`);
        console.log(`  -d '{"token":"${customToken}","returnSecureToken":true}' | python3 -m json.tool\n`);
        console.log('→ Copy the "idToken" value from the response and paste it into Postman.\n');
        console.log('OPTION B: Find your Web API Key at:');
        console.log('   Firebase Console → Project Settings → General → Web API Key');
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
        console.error('Error:', error.message);
    }
    process.exit(0);
};

generateToken();

/**
 * One-time migration script — patches all HOD teachers who were registered
 * before the role casing fix and have role: 'HOD' or 'TEACHER' in Firestore.
 *
 * Run: node fix_existing_hods.js
 * Safe to run multiple times (idempotent — only updates docs that need it).
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(
    readFileSync(join(__dirname, 'smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json'), 'utf8')
);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function patchHods() {
    console.log('🔍 Searching for HOD teachers with uppercase role...');

    // Patch role: 'HOD' → 'hod'
    const hodSnap = await db.collection('teachers')
        .where('isHod', '==', true)
        .get();

    if (hodSnap.empty) {
        console.log('✅ No HOD documents found — nothing to patch.');
    } else {
        const batch = db.batch();
        let count = 0;
        hodSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.role !== 'hod') {
                batch.update(doc.ref, {
                    role: 'hod',
                    updatedAt: FieldValue.serverTimestamp()
                });
                console.log(`  → Patching HOD: ${data.name || doc.id} (was: ${data.role})`);
                count++;
            }
        });
        if (count > 0) {
            await batch.commit();
            console.log(`✅ Patched ${count} HOD document(s) → role: 'hod'`);
        } else {
            console.log('✅ All HOD documents already have correct lowercase role.');
        }
    }

    // Also catch any plain teachers stuck with 'TEACHER'
    const teacherSnap = await db.collection('teachers')
        .where('role', '==', 'TEACHER')
        .get();

    if (!teacherSnap.empty) {
        const batch2 = db.batch();
        teacherSnap.docs.forEach(doc => {
            batch2.update(doc.ref, {
                role: 'teacher',
                updatedAt: FieldValue.serverTimestamp()
            });
            console.log(`  → Patching TEACHER: ${doc.data().name || doc.id}`);
        });
        await batch2.commit();
        console.log(`✅ Patched ${teacherSnap.size} TEACHER document(s) → role: 'teacher'`);
    } else {
        console.log('✅ No uppercase TEACHER documents found.');
    }

    console.log('\n🎉 Migration complete. All roles are now lowercase.');
    process.exit(0);
}

patchHods().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});

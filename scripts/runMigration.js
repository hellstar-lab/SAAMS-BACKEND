// Safe to run multiple times - only adds missing fields, never overwrites existing values
import admin from 'firebase-admin';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const serviceAccount = require('../smart-attendance-app-2f038-firebase-adminsdk-fbsvc-79631dd66a.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const val = (existing, fallback) =>
    existing !== undefined && existing !== null ? existing : fallback;

async function processInBatches(collectionName, updateLogic) {
    const snapshot = await db.collection(collectionName).get();
    let updatedCount = 0;

    const chunks = [];
    let currentChunk = [];

    snapshot.docs.forEach(doc => {
        currentChunk.push(doc);
        if (currentChunk.length === 400) {
            chunks.push(currentChunk);
            currentChunk = [];
        }
    });
    if (currentChunk.length > 0) chunks.push(currentChunk);

    for (const chunk of chunks) {
        const batch = db.batch();
        let batchHasUpdates = false;

        for (const doc of chunk) {
            const data = doc.data();
            const updates = updateLogic(doc.id, data);

            if (Object.keys(updates).length > 0) {
                batch.update(doc.ref, updates);
                batchHasUpdates = true;
                updatedCount++;
            }
        }

        if (batchHasUpdates) {
            await batch.commit();
        }
    }

    return updatedCount;
}

async function main() {
    try {
        const stats = { teachers: 0, students: 0, classes: 0, sessions: 0, attendance: 0 };

        // 1. UPDATE teachers
        console.log("🔄 Processing teachers...");
        stats.teachers = await processInBatches('teachers', (id, data) => {
            const updates = {};
            const fields = {
                phone: null,
                profilePhotoUrl: null,
                departmentId: null,
                departmentName: null,
                designation: null,
                isHod: false,
                subjectsTaught: [],
                fcmToken: null,
                isActive: true,
                lastLoginAt: null
            };

            for (const [key, fallback] of Object.entries(fields)) {
                if (val(data[key], undefined) === undefined) {
                    updates[key] = fallback;
                }
            }

            if (val(data.updatedAt, undefined) === undefined) {
                updates.updatedAt = FieldValue.serverTimestamp();
            }

            return updates;
        });
        console.log(`✅ Teachers done: ${stats.teachers} updated`);

        // 2. UPDATE students
        console.log("🔄 Processing students...");
        stats.students = await processInBatches('students', (id, data) => {
            const updates = {};

            const faceRegisteredFallback = Array.isArray(data.faceDescriptor) && data.faceDescriptor.length > 0;

            const fields = {
                phone: null,
                profilePhotoUrl: null,
                rollNumber: val(data.studentId, null),
                departmentId: null,
                departmentName: null,
                semester: null,
                section: null,
                batch: null,
                faceRegistered: faceRegisteredFallback,
                deviceId: null,
                fcmToken: null,
                attendanceWarned: false,
                isActive: true,
                lastLoginAt: null
            };

            for (const [key, fallback] of Object.entries(fields)) {
                if (val(data[key], undefined) === undefined) {
                    updates[key] = fallback;
                }
            }

            if (val(data.updatedAt, undefined) === undefined) {
                updates.updatedAt = FieldValue.serverTimestamp();
            }

            return updates;
        });
        console.log(`✅ Students done: ${stats.students} updated`);

        // 3. UPDATE classes
        console.log("🔄 Processing classes...");
        stats.classes = await processInBatches('classes', (id, data) => {
            const updates = {};
            const fields = {
                departmentId: null,
                departmentName: null,
                teacherName: null,
                semester: null,
                section: null,
                batch: null,
                academicYear: '2024-25',
                totalSessions: 0,
                minAttendance: 75,
                isActive: true
            };

            for (const [key, fallback] of Object.entries(fields)) {
                if (val(data[key], undefined) === undefined) {
                    updates[key] = fallback;
                }
            }

            if (val(data.updatedAt, undefined) === undefined) {
                updates.updatedAt = FieldValue.serverTimestamp();
            }

            return updates;
        });
        console.log(`✅ Classes done: ${stats.classes} updated`);

        // 4. UPDATE sessions
        console.log("🔄 Processing sessions...");
        stats.sessions = await processInBatches('sessions', (id, data) => {
            const updates = {};
            const fields = {
                teacherName: null,
                departmentId: null,
                subjectName: null,
                subjectCode: null,
                semester: null,
                section: null,
                batch: null,
                academicYear: '2024-25',
                faceRequired: false,
                autoAbsentMinutes: 5,
                totalStudents: 0,
                roomNumber: null,
                buildingName: null,
                qrRefreshInterval: null,
                qrLastRefreshed: null,
                teacherLat: null,
                teacherLng: null,
                radiusMeters: null,
                expectedSSID: null,
                bleSessionCode: null,
                endTime: null
            };

            for (const [key, fallback] of Object.entries(fields)) {
                if (val(data[key], undefined) === undefined) {
                    updates[key] = fallback;
                }
            }

            return updates;
        });
        console.log(`✅ Sessions done: ${stats.sessions} updated`);

        // 5. UPDATE attendance
        console.log("🔄 Processing attendance...");
        const attendanceSnapshot = await db.collection('attendance').get();
        let attendanceUpdatedCount = 0;

        for (const doc of attendanceSnapshot.docs) {
            const data = doc.data();
            const updates = {};

            let studentDocData = {};
            let sessionDocData = {};

            if (data.studentId) {
                // Step A: fetch the student document using studentId field
                const sQuery = await db.collection('students').where('studentId', '==', data.studentId).limit(1).get();
                if (!sQuery.empty) {
                    studentDocData = sQuery.docs[0].data();
                } else {
                    const sDoc = await db.collection('students').doc(data.studentId).get();
                    if (sDoc.exists) studentDocData = sDoc.data();
                }
            }

            if (data.sessionId) {
                // Step B: fetch the session document using sessionId field
                const sessQuery = await db.collection('sessions').where('sessionId', '==', data.sessionId).limit(1).get();
                if (!sessQuery.empty) {
                    sessionDocData = sessQuery.docs[0].data();
                } else {
                    const sessDoc = await db.collection('sessions').doc(data.sessionId).get();
                    if (sessDoc.exists) sessionDocData = sessDoc.data();
                }
            }

            let teacherApprovedVal = null;
            if (data.status === 'present') teacherApprovedVal = true;
            else if (data.status === 'absent') teacherApprovedVal = false;
            else if (data.status === 'late') teacherApprovedVal = null;

            const fields = {
                studentName: val(studentDocData.name, null),
                studentRollNumber: val(studentDocData.rollNumber, val(studentDocData.studentId, null)),
                classId: val(sessionDocData.classId, null),
                teacherId: val(sessionDocData.teacherId, null),
                departmentId: val(sessionDocData.departmentId, null),
                semester: val(sessionDocData.semester, null),
                section: val(sessionDocData.section, null),
                teacherApproved: teacherApprovedVal,
                approvedAt: null,
                autoAbsent: false,
                faceScore: null,
                deviceId: null,
                deviceBlocked: false,
                isSuspicious: false,
                suspiciousReason: null,
                studentLat: null,
                studentLng: null,
                distanceFromClass: null,
                networkSSID: null,
                bleRSSI: null,
                joinedAt: val(data.createdAt, null),
                markedAt: val(data.createdAt, null)
            };

            for (const [key, fallback] of Object.entries(fields)) {
                if (val(data[key], undefined) === undefined) {
                    updates[key] = fallback;
                }
            }

            if (Object.keys(updates).length > 0) {
                await doc.ref.update(updates);
                attendanceUpdatedCount++;
            }
        }
        stats.attendance = attendanceUpdatedCount;
        console.log(`✅ Attendance done: ${stats.attendance} updated`);

        console.log("\n📊 FINAL MIGRATION SUMMARY");
        console.table(stats);

    } catch (error) {
        console.error("Migration failed:\n", error);
    }
}

main();

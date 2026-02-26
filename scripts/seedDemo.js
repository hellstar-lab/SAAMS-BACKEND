// SAAMS DEMO SEED SCRIPT
// Creates realistic demo data for
// college presentation.
// Safe to run multiple times.
// Run with: node scripts/seedDemo.js
// Credentials printed at end of run.

import { v4 as uuidv4 } from 'uuid';
import { db, auth, admin } from '../config/firebase.js';

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const firstNames = [
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan',
    'Arjun', 'Sai', 'Reyansh', 'Ayaan',
    'Krishna', 'Ishaan', 'Shaurya', 'Atharv',
    'Advik', 'Pranav', 'Advait', 'Divya',
    'Ananya', 'Priya', 'Sneha', 'Pooja',
    'Riya', 'Shreya', 'Kavya', 'Aishwarya',
    'Neha', 'Simran', 'Tanvi', 'Meera',
    'Nisha', 'Kritika'
];
const lastNames = [
    'Sharma', 'Verma', 'Patel', 'Singh',
    'Kumar', 'Gupta', 'Joshi', 'Mehta',
    'Agarwal', 'Yadav', 'Mishra', 'Tiwari',
    'Pandey', 'Chauhan', 'Shah', 'Nair',
    'Reddy', 'Iyer', 'Pillai', 'Menon'
];

async function seedSuperAdmin() {
    console.log('Creating Super Admin...');
    const email = 'admin@saams.edu';
    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(email);
        console.log('✅ SuperAdmin already exists, skipping');
        return userRecord.uid;
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            userRecord = await auth.createUser({
                email: email,
                password: 'Admin@2024',
                displayName: 'Dr. Rajesh Sharma',
            });
            await db.collection('superAdmin').doc(userRecord.uid).set({
                adminId: userRecord.uid,
                name: 'Dr. Rajesh Sharma',
                email: email,
                role: 'superAdmin',
                phone: '+91-9876543210',
                isActive: true,
                permissions: ['all'],
                createdAt: FieldValue.serverTimestamp()
            });
            return userRecord.uid;
        } else {
            throw error;
        }
    }
}

async function seedDepartments() {
    console.log('Creating Departments...');
    const csQuery = await db.collection('departments').where('code', '==', 'CS').limit(1).get();
    let csDeptId, ecDeptId;

    if (!csQuery.empty) {
        console.log('✅ Departments already exist, skipping');
        csDeptId = csQuery.docs[0].id;
        const ecQuery = await db.collection('departments').where('code', '==', 'EC').limit(1).get();
        ecDeptId = ecQuery.docs[0].id;
        return { csDeptId, ecDeptId };
    }

    const csDeptRef = db.collection('departments').doc();
    csDeptId = csDeptRef.id;
    await csDeptRef.set({
        departmentId: csDeptId,
        name: 'Computer Science',
        code: 'CS',
        minAttendance: 75,
        isActive: true,
        totalTeachers: 2,
        totalStudents: 60,
        totalClasses: 4,
        createdAt: FieldValue.serverTimestamp()
    });

    const ecDeptRef = db.collection('departments').doc();
    ecDeptId = ecDeptRef.id;
    await ecDeptRef.set({
        departmentId: ecDeptId,
        name: 'Electronics Engineering',
        code: 'EC',
        minAttendance: 75,
        isActive: true,
        totalTeachers: 2,
        totalStudents: 40,
        totalClasses: 4,
        createdAt: FieldValue.serverTimestamp()
    });

    return { csDeptId, ecDeptId };
}

async function seedTeachers(csDeptId, ecDeptId) {
    console.log('Creating Teachers...');
    const teachersConfig = [
        {
            name: 'Dr. Priya Mehta', email: 'priya.mehta@saams.edu', password: 'Teacher@123',
            employeeId: 'CS-T001', designation: 'Professor & HOD', departmentId: csDeptId,
            departmentName: 'Computer Science', isHod: true, role: 'hod', key: 'csHodUid'
        },
        {
            name: 'Mr. Amit Kumar', email: 'amit.kumar@saams.edu', password: 'Teacher@123',
            employeeId: 'CS-T002', designation: 'Assistant Professor', departmentId: csDeptId,
            departmentName: 'Computer Science', isHod: false, role: 'teacher', key: 'csTeacherUid'
        },
        {
            name: 'Dr. Sunita Patel', email: 'sunita.patel@saams.edu', password: 'Teacher@123',
            employeeId: 'EC-T001', designation: 'Professor & HOD', departmentId: ecDeptId,
            departmentName: 'Electronics Engineering', isHod: true, role: 'hod', key: 'ecHodUid'
        },
        {
            name: 'Mr. Rahul Verma', email: 'rahul.verma@saams.edu', password: 'Teacher@123',
            employeeId: 'EC-T002', designation: 'Assistant Professor', departmentId: ecDeptId,
            departmentName: 'Electronics Engineering', isHod: false, role: 'teacher', key: 'ecTeacherUid'
        }
    ];

    const teacherUids = {};

    for (const t of teachersConfig) {
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(t.email);
            console.log(`✅ Teacher ${t.name} exists`);
            teacherUids[t.key] = userRecord.uid;
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                userRecord = await auth.createUser({
                    email: t.email,
                    password: t.password,
                    displayName: t.name
                });
                teacherUids[t.key] = userRecord.uid;
                await db.collection('teachers').doc(userRecord.uid).set({
                    teacherId: userRecord.uid,
                    name: t.name,
                    email: t.email,
                    employeeId: t.employeeId,
                    designation: t.designation,
                    departmentId: t.departmentId,
                    departmentName: t.departmentName,
                    isHod: t.isHod,
                    role: t.role,
                    isActive: true,
                    createdAt: FieldValue.serverTimestamp()
                });

                if (t.isHod) {
                    await db.collection('departments').doc(t.departmentId).update({
                        hodId: userRecord.uid,
                        hodName: t.name
                    });
                }
            } else {
                throw err;
            }
        }
    }

    return teacherUids;
}

async function seedStudents(csDeptId, ecDeptId) {
    console.log('Creating Students...');

    const studentGroups = [
        { key: 'csSem3A', deptId: csDeptId, deptName: 'Computer Science', prefix: '22CS', start: 1, count: 20, sem: 3, sec: 'A' },
        { key: 'csSem3B', deptId: csDeptId, deptName: 'Computer Science', prefix: '22CS', start: 21, count: 20, sem: 3, sec: 'B' },
        { key: 'csSem5A', deptId: csDeptId, deptName: 'Computer Science', prefix: '21CS', start: 1, count: 20, sem: 5, sec: 'A' },
        { key: 'ecSem3A', deptId: ecDeptId, deptName: 'Electronics Engineering', prefix: '22EC', start: 1, count: 20, sem: 3, sec: 'A' },
        { key: 'ecSem5A', deptId: ecDeptId, deptName: 'Electronics Engineering', prefix: '21EC', start: 1, count: 20, sem: 5, sec: 'A' }
    ];

    const studentUids = { csSem3A: [], csSem3B: [], csSem5A: [], ecSem3A: [], ecSem5A: [] };
    let globalNameIndex = 0;

    for (const group of studentGroups) {
        const firstRoll = `${group.prefix}${String(group.start).padStart(3, '0')}`;
        const firstEmail = `${firstRoll.toLowerCase()}@student.saams.edu`;

        let alreadySeeded = false;
        let firstUserRecord;
        try {
            firstUserRecord = await auth.getUserByEmail(firstEmail);
            alreadySeeded = true;
        } catch (err) {
            if (err.code !== 'auth/user-not-found') throw err;
        }

        if (alreadySeeded) {
            console.log(`✅ ${group.deptName} Sem ${group.sem} Section ${group.sec} already seeded`);
            // Just fetch the UIDs for this group to return
            const snap = await db.collection('students')
                .where('departmentId', '==', group.deptId)
                .where('semester', '==', group.sem)
                .where('section', '==', group.sec)
                .get();
            studentUids[group.key] = snap.docs.map(d => d.id);
            continue;
        }

        console.log(`Creating ${group.deptName} Sem ${group.sem} Section ${group.sec} students (${group.start}-${group.start + group.count - 1})...`);

        for (let i = 0; i < group.count; i++) {
            const rollNum = `${group.prefix}${String(group.start + i).padStart(3, '0')}`;
            const email = `${rollNum.toLowerCase()}@student.saams.edu`;
            const fname = firstNames[globalNameIndex % 30];
            const lname = lastNames[globalNameIndex % 20];
            globalNameIndex++;
            const fullName = `${fname} ${lname}`;

            const userRecord = await auth.createUser({
                email,
                password: 'Student@123',
                displayName: fullName
            });

            studentUids[group.key].push(userRecord.uid);

            await db.collection('students').doc(userRecord.uid).set({
                studentId: userRecord.uid,
                name: fullName,
                email,
                rollNumber: rollNum,
                departmentId: group.deptId,
                departmentName: group.deptName,
                semester: group.sem,
                section: group.sec,
                batch: `20${group.prefix.substring(0, 2)}`,
                role: 'student',
                faceRegistered: true,
                isActive: true,
                attendanceWarned: false,
                createdAt: FieldValue.serverTimestamp()
            });
        }
    }

    return studentUids;
}

async function seedClasses(teacherUids, studentUids, csDeptId, ecDeptId) {
    console.log('Creating Classes...');
    const cs301Check = await db.collection('classes').where('subjectCode', '==', 'CS301').where('teacherId', '==', teacherUids.csHodUid).limit(1).get();

    if (!cs301Check.empty) {
        console.log('✅ Classes already exist, skipping creation');
        const existingClasses = await db.collection('classes').get();
        return existingClasses.docs.map(doc => doc.id);
    }

    const classesConfig = [
        { subjectName: 'Data Structures', subjectCode: 'CS301', teacherId: teacherUids.csHodUid, teacherName: 'Dr. Priya Mehta', semester: 3, section: 'A', departmentId: csDeptId, students: studentUids.csSem3A },
        { subjectName: 'Data Structures', subjectCode: 'CS301', teacherId: teacherUids.csHodUid, teacherName: 'Dr. Priya Mehta', semester: 3, section: 'B', departmentId: csDeptId, students: studentUids.csSem3B },
        { subjectName: 'Operating Systems', subjectCode: 'CS501', teacherId: teacherUids.csTeacherUid, teacherName: 'Mr. Amit Kumar', semester: 5, section: 'A', departmentId: csDeptId, students: studentUids.csSem5A },
        { subjectName: 'Computer Networks', subjectCode: 'CS502', teacherId: teacherUids.csTeacherUid, teacherName: 'Mr. Amit Kumar', semester: 5, section: 'A', departmentId: csDeptId, students: studentUids.csSem5A },

        { subjectName: 'Circuit Theory', subjectCode: 'EC301', teacherId: teacherUids.ecHodUid, teacherName: 'Dr. Sunita Patel', semester: 3, section: 'A', departmentId: ecDeptId, students: studentUids.ecSem3A },
        { subjectName: 'Digital Electronics', subjectCode: 'EC302', teacherId: teacherUids.ecTeacherUid, teacherName: 'Mr. Rahul Verma', semester: 3, section: 'A', departmentId: ecDeptId, students: studentUids.ecSem3A },
        { subjectName: 'Signal Processing', subjectCode: 'EC501', teacherId: teacherUids.ecHodUid, teacherName: 'Dr. Sunita Patel', semester: 5, section: 'A', departmentId: ecDeptId, students: studentUids.ecSem5A },
        { subjectName: 'Microprocessors', subjectCode: 'EC502', teacherId: teacherUids.ecTeacherUid, teacherName: 'Mr. Rahul Verma', semester: 5, section: 'A', departmentId: ecDeptId, students: studentUids.ecSem5A }
    ];

    const classIds = [];
    const batch = db.batch();

    for (const c of classesConfig) {
        const classRef = db.collection('classes').doc();
        classIds.push(classRef.id);
        batch.set(classRef, {
            classId: classRef.id,
            subjectName: c.subjectName,
            subjectCode: c.subjectCode,
            teacherId: c.teacherId,
            teacherName: c.teacherName,
            departmentId: c.departmentId,
            semester: c.semester,
            section: c.section,
            students: c.students,
            totalSessions: 5,
            isActive: true,
            createdAt: FieldValue.serverTimestamp()
        });
    }

    await batch.commit();
    return classIds;
}

async function seedSessionsAndAttendance(classIds, teacherUids, studentUids, deptIds) {
    console.log('Creating Sessions and Attendance (Past 30 days)...');

    // Let's check if sessions exist
    const existingSessions = await db.collection('sessions').limit(1).get();
    if (!existingSessions.empty) {
        console.log('✅ Sessions and Attendance might already exist. Skipping to avoid massive duplicates.');
        return;
    }

    // To map class ID back to object config
    const allClasses = await db.collection('classes').get();
    const classDocs = allClasses.docs.map(d => d.data());

    // Batch configuration
    let batch = db.batch();
    let batchCount = 0;

    const commitBatch = async () => {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
    };

    for (let classIndex = 0; classIndex < classDocs.length; classIndex++) {
        const cls = classDocs[classIndex];
        if (!cls.students || cls.students.length === 0) continue;

        console.log(`Generating sessions for ${cls.subjectName} (${cls.section})...`);

        for (let sessionIndex = 0; sessionIndex < 5; sessionIndex++) {
            const sessionDate = new Date();
            sessionDate.setDate(sessionDate.getDate() - (sessionIndex * 6));
            sessionDate.setHours(9 + classIndex, 0, 0, 0);

            const endDate = new Date(sessionDate.getTime());
            endDate.setHours(sessionDate.getHours() + 1, 30, 0, 0);

            const sessionRef = db.collection('sessions').doc();
            const sessionId = sessionRef.id;

            const method = sessionIndex % 2 === 0 ? 'qrcode' : 'gps';

            batch.set(sessionRef, {
                sessionId,
                classId: cls.classId,
                teacherId: cls.teacherId,
                teacherName: cls.teacherName,
                departmentId: cls.departmentId,
                subjectName: cls.subjectName,
                method,
                status: 'ended',
                lateAfterMinutes: 10,
                startTime: Timestamp.fromDate(sessionDate),
                endTime: Timestamp.fromDate(endDate),
                totalStudents: cls.students.length,
                createdAt: Timestamp.fromDate(sessionDate)
            });
            batchCount++;
            if (batchCount >= 400) await commitBatch();

            // Generate attendance for each student in the class
            for (let i = 0; i < cls.students.length; i++) {
                const studentId = cls.students[i];
                const attendanceRef = db.collection('attendance').doc();

                // 75% present, 15% absent, 10% late
                let status = 'present';
                let teacherApproved = true;
                let autoAbsent = false;
                let faceVerified = true;

                const rand = Math.random();
                if (rand > 0.85) {
                    status = 'absent';
                    teacherApproved = false;
                    autoAbsent = true;
                    faceVerified = false;
                } else if (rand > 0.75) {
                    status = 'late';
                }

                const faceScore = faceVerified ? parseFloat((Math.random() * (0.97 - 0.82) + 0.82).toFixed(2)) : null;

                // Generate a markedAt within the session timeframe
                const markedAtDelay = Math.floor(Math.random() * 60) * 60000; // random minute within first hour
                const joinedAtTime = new Date(sessionDate.getTime() + markedAtDelay);

                batch.set(attendanceRef, {
                    attendanceId: attendanceRef.id,
                    sessionId,
                    classId: cls.classId,
                    departmentId: cls.departmentId,
                    studentId,
                    status,
                    method,
                    faceVerified,
                    faceScore,
                    teacherApproved,
                    autoAbsent,
                    isSuspicious: false,
                    joinedAt: Timestamp.fromDate(joinedAtTime),
                    markedAt: Timestamp.fromDate(joinedAtTime),
                    createdAt: Timestamp.fromDate(joinedAtTime)
                });

                batchCount++;
                if (batchCount >= 400) await commitBatch();
            }
        }
    }

    if (batchCount > 0) {
        await commitBatch();
    }
}

async function seedAttendanceSummaries(classIds, studentUids, deptIds, teacherUids) {
    console.log('Creating Attendance Summaries...');

    // Check existence
    const existingSummas = await db.collection('attendanceSummary').limit(1).get()
    if (!existingSummas.empty) {
        console.log('✅ Summaries might exist. Skipping.');
        return;
    }

    const allClasses = await db.collection('classes').get();

    let batch = db.batch();
    let batchCount = 0;

    for (const classDoc of allClasses.docs) {
        const cls = classDoc.data();
        if (!cls.students) continue;

        for (let i = 0; i < cls.students.length; i++) {
            const studentId = cls.students[i];
            const summaryId = `${studentId}_${cls.classId}`;
            const summaryRef = db.collection('attendanceSummary').doc(summaryId);

            // bottom 15% gets below 75%. i / total < 0.15
            const isAtRisk = (i / cls.students.length) < 0.15;
            const percentage = isAtRisk ? Math.floor(Math.random() * (74 - 50 + 1)) + 50 : Math.floor(Math.random() * (95 - 80 + 1)) + 80;

            // 5 sessions total
            const totalPresent = Math.round((percentage / 100) * 5);
            const totalAbsent = 5 - totalPresent;

            batch.set(summaryRef, {
                summaryId,
                studentId,
                classId: cls.classId,
                departmentId: cls.departmentId,
                semester: cls.semester,
                academicYear: '2023-24', // or dynamic
                totalClasses: 5,
                totalPresent,
                totalAbsent,
                percentage,
                isBelowThreshold: isAtRisk,
                updatedAt: FieldValue.serverTimestamp()
            });

            batchCount++;
            if (batchCount >= 400) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
    }

    if (batchCount > 0) await batch.commit();
}

async function seedDisputes(studentUids, classIds, teacherUids, deptIds) {
    console.log('Creating Sample Disputes...');

    const existingDisputes = await db.collection('disputes').limit(1).get();
    if (!existingDisputes.empty) {
        console.log('✅ Disputes exist. Skipping.');
        return;
    }

    const disputes = [
        {
            studentId: studentUids.csSem3A[0],
            deptId: deptIds.csDeptId,
            teacherId: teacherUids.csHodUid,
            originalStatus: 'absent',
            reason: 'I was present but the QR code was not scanning on my phone. I showed my phone to the teacher but the session had already ended.',
        },
        {
            studentId: studentUids.ecSem3A[0],
            deptId: deptIds.ecDeptId,
            teacherId: teacherUids.ecHodUid,
            originalStatus: 'absent',
            reason: 'I was inside the classroom but my GPS was showing wrong location. I have screenshots as proof.',
        },
        {
            studentId: studentUids.csSem3A[1],
            deptId: deptIds.csDeptId,
            teacherId: teacherUids.csHodUid,
            originalStatus: 'late',
            reason: 'I was on time but the entry was blocked due to a fire drill in the building. All students from my section were delayed.',
        }
    ];

    for (const d of disputes) {
        const studentDoc = await db.collection('students').doc(d.studentId).get();
        const teacherDoc = await db.collection('teachers').doc(d.teacherId).get();

        const sData = studentDoc.data();
        const tData = teacherDoc.data();

        const disputeRef = db.collection('disputes').doc();
        await disputeRef.set({
            disputeId: disputeRef.id,
            departmentId: d.deptId,
            studentId: d.studentId,
            studentName: sData.name,
            studentRollNumber: sData.rollNumber,
            teacherId: d.teacherId,
            teacherName: tData.name,
            subjectName: 'Data Structures / Circuit Theory', // stubbed
            originalStatus: d.originalStatus,
            reason: d.reason,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
    }
}

async function seedFraudFlags(deptIds) {
    console.log('Creating Sample Fraud Flags...');

    const existingCards = await db.collection('fraudFlags').limit(1).get();
    if (!existingCards.empty) {
        console.log('✅ Fraud flags exist. Skipping.');
        return;
    }

    const ref1 = db.collection('fraudFlags').doc();
    await ref1.set({
        flagId: ref1.id,
        type: 'duplicate_device',
        status: 'pending',
        departmentId: deptIds.csDeptId,
        details: { reason: 'Demo fraud flag 1' },
        createdAt: FieldValue.serverTimestamp()
    });

    const ref2 = db.collection('fraudFlags').doc();
    await ref2.set({
        flagId: ref2.id,
        type: 'gps_proximity',
        status: 'pending',
        departmentId: deptIds.ecDeptId,
        details: { reason: 'Demo fraud flag 2' },
        createdAt: FieldValue.serverTimestamp()
    });
}

async function main() {
    console.log('🌱 Starting SAAMS demo seed...\n');
    let csDeptId, ecDeptId;

    try {
        const adminUid = await seedSuperAdmin()
        console.log('✅ SuperAdmin done\n')

        const depts = await seedDepartments()
        csDeptId = depts.csDeptId
        ecDeptId = depts.ecDeptId
        console.log('✅ Departments done\n')

        const teacherUids = await seedTeachers(csDeptId, ecDeptId)
        console.log('✅ Teachers done\n')

        const studentUids = await seedStudents(csDeptId, ecDeptId)
        console.log('✅ Students done (100 total)\n')

        const classIds = await seedClasses(teacherUids, studentUids, csDeptId, ecDeptId)
        console.log('✅ Classes done (8 total)\n')

        await seedSessionsAndAttendance(classIds, teacherUids, studentUids, { csDeptId, ecDeptId })
        console.log('✅ Sessions + Attendance done\n')

        await seedAttendanceSummaries(classIds, studentUids, { csDeptId, ecDeptId }, teacherUids)
        console.log('✅ Summaries done\n')

        await seedDisputes(studentUids, classIds, teacherUids, { csDeptId, ecDeptId })
        console.log('✅ Disputes done\n')

        await seedFraudFlags({ csDeptId, ecDeptId })
        console.log('✅ Fraud flags done\n')

        console.log('')
        console.log('🎉 Demo seed complete!')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('DEMO LOGIN CREDENTIALS:')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('Super Admin:')
        console.log('  Email: admin@saams.edu')
        console.log('  Password: Admin@2024')
        console.log('')
        console.log('CS HOD:')
        console.log('  Email: priya.mehta@saams.edu')
        console.log('  Password: Teacher@123')
        console.log('')
        console.log('CS Teacher:')
        console.log('  Email: amit.kumar@saams.edu')
        console.log('  Password: Teacher@123')
        console.log('')
        console.log('Sample Student:')
        console.log('  Email: 22cs001@student.saams.edu')
        console.log('  Password: Student@123')
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

        process.exit(0)
    } catch (err) {
        console.error('❌ Seed failed:', err)
        process.exit(1)
    }
}

main().catch(err => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
})

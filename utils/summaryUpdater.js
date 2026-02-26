/**
 * SUMMARY UPDATER
 * Maintains running attendance totals per student per class.
 * Called after every attendance write.
 * Document ID format: studentId_classId
 * Never call this directly from routes — only from attendanceController.
 */

import { FieldValue } from 'firebase-admin/firestore';

/**
 * Updates or creates the attendanceSummary document on attendance mark.
 * @param {Object} db Firestore instance
 * @param {Object} attendanceData Object with { studentId, classId, status, sessionId, teacherId, departmentId, semester, section, batch, academicYear }
 * @param {Object} classData Object with { subjectName, subjectCode, minAttendance }
 * @param {Object} studentData Object with { name, rollNumber }
 * @returns {Promise<Object|false>} Object with updated stats or false on error
 */
const updateSummaryOnAttendance = async (db, attendanceData, classData, studentData) => {
    try {
        const { studentId, classId, status, teacherId, departmentId, semester, section, batch, academicYear } = attendanceData;
        const summaryId = `${studentId}_${classId}`;
        const ref = db.collection('attendanceSummary').doc(summaryId);

        const doc = await ref.get();
        let wasBelowThreshold = false;
        let isBelowThreshold = false;
        let percentage = 100;

        if (doc.exists) {
            const data = doc.data();
            wasBelowThreshold = data.isBelowThreshold || false;
            let { present = 0, late = 0, absent = 0, totalSessions = 0 } = data;

            if (status === 'present') present++;
            else if (status === 'late') late++;
            else if (status === 'absent') absent++;

            totalSessions++;
            percentage = parseFloat((((present + late) / totalSessions) * 100).toFixed(2));
            isBelowThreshold = percentage < data.minAttendance;

            await ref.update({
                present, late, absent, totalSessions, percentage,
                isBelowThreshold, lastUpdated: FieldValue.serverTimestamp()
            });
        } else {
            const minAttr = classData.minAttendance || 75;
            const isAbsent = status === 'absent';
            percentage = isAbsent ? 0 : 100;
            isBelowThreshold = isAbsent && (0 < minAttr);

            await ref.set({
                summaryId, studentId, studentName: studentData.name,
                studentRollNumber: studentData.rollNumber,
                classId, subjectName: classData.subjectName,
                subjectCode: classData.subjectCode,
                teacherId, departmentId, semester, section,
                batch, academicYear,
                present: status === 'present' ? 1 : 0,
                late: status === 'late' ? 1 : 0,
                absent: status === 'absent' ? 1 : 0,
                totalSessions: 1, percentage, isBelowThreshold,
                minAttendance: minAttr, lastWarningAt: null,
                lastUpdated: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp()
            });
        }

        return {
            summaryId,
            percentage,
            isBelowThreshold,
            isFirstTimeBelowThreshold: (!wasBelowThreshold && isBelowThreshold)
        };
    } catch (error) {
        console.error('updateSummaryOnAttendance error:', error);
        return false;
    }
};

/**
 * Adjusts counters and percentages when teacher changes late status.
 * @param {Object} db Firestore instance
 * @param {string} studentId DB ID of the student
 * @param {string} classId DB ID of the class
 * @param {string} oldStatus Prior recorded status (e.g., 'late')
 * @param {string} newStatus Newly assigned status (e.g., 'present' or 'absent')
 * @returns {Promise<number|false>} The freshly calculated percentage or false on error
 */
const updateSummaryOnApproval = async (db, studentId, classId, oldStatus, newStatus) => {
    try {
        const summaryId = `${studentId}_${classId}`;
        const ref = db.collection('attendanceSummary').doc(summaryId);
        const doc = await ref.get();
        if (!doc.exists) return false;

        const data = doc.data();
        let present = data.present || 0;
        let late = data.late || 0;
        let absent = data.absent || 0;

        if (oldStatus === 'present') present = Math.max(0, present - 1);
        if (oldStatus === 'late') late = Math.max(0, late - 1);
        if (oldStatus === 'absent') absent = Math.max(0, absent - 1);

        if (newStatus === 'present') present++;
        if (newStatus === 'late') late++;
        if (newStatus === 'absent') absent++;

        const totalSessions = data.totalSessions || 1;
        const percentage = parseFloat((((present + late) / totalSessions) * 100).toFixed(2));
        const isBelowThreshold = percentage < (data.minAttendance || 75);

        await ref.update({
            present, late, absent, percentage,
            isBelowThreshold, lastUpdated: FieldValue.serverTimestamp()
        });

        return percentage;
    } catch (error) {
        console.error('updateSummaryOnApproval error:', error);
        return false;
    }
};

/**
 * Pulls all subject attendance summaries for a single student.
 * @param {Object} db Firestore instance
 * @param {string} studentId DB ID of the student
 * @param {string} academicYear Target academic year for the dashboard summary
 * @returns {Promise<Array>} Array of summary docs
 */
const getSummaryForStudent = async (db, studentId, academicYear) => {
    try {
        const snap = await db.collection('attendanceSummary')
            .where('studentId', '==', studentId)
            .where('academicYear', '==', academicYear)
            .get();
        return snap.empty ? [] : snap.docs.map(doc => doc.data());
    } catch (error) {
        console.error('getSummaryForStudent error:', error);
        return [];
    }
};

/**
 * Pulls all student attendance summaries for a single class.
 * @param {Object} db Firestore instance
 * @param {string} classId Target class group
 * @returns {Promise<Array>} Ordered array of summary docs (lowest attendance first)
 */
const getSummaryForClass = async (db, classId) => {
    try {
        const snap = await db.collection('attendanceSummary')
            .where('classId', '==', classId)
            .orderBy('percentage', 'asc')
            .get();
        return snap.empty ? [] : snap.docs.map(doc => doc.data());
    } catch (error) {
        console.error('getSummaryForClass error:', error);
        return [];
    }
};

/**
 * Pulls all students across a department failing minAttendance.
 * @param {Object} db Firestore instance
 * @param {string} departmentId Target department filter
 * @param {number} semester Target semester filter
 * @returns {Promise<Array>} Deficient students ordered by percentage
 */
const getStudentsBelowThreshold = async (db, departmentId, semester) => {
    try {
        const snap = await db.collection('attendanceSummary')
            .where('departmentId', '==', departmentId)
            .where('semester', '==', semester)
            .where('isBelowThreshold', '==', true)
            .orderBy('percentage', 'asc')
            .get();
        return snap.empty ? [] : snap.docs.map(doc => doc.data());
    } catch (error) {
        console.error('getStudentsBelowThreshold error:', error);
        return [];
    }
};

/**
 * Calculates heavy department analytics dynamically.
 * @param {Object} db Firestore instance
 * @param {string} departmentId Target department filter
 * @param {string} academicYear Target academic year scoping
 * @returns {Promise<Object|null>} Detailed statistical aggregate mapping or null on failure
 */
const getDepartmentStats = async (db, departmentId, academicYear) => {
    try {
        const snap = await db.collection('attendanceSummary')
            .where('departmentId', '==', departmentId)
            .where('academicYear', '==', academicYear)
            .get();

        if (snap.empty) return null;

        const docs = snap.docs.map(d => d.data());
        const studentSet = new Set();
        const classSet = new Set();
        let percentageSum = 0;
        let studentsBelow75 = 0;
        let studentsAbove90 = 0;

        for (const doc of docs) {
            studentSet.add(doc.studentId);
            classSet.add(doc.classId);
            percentageSum += doc.percentage || 0;
            if (doc.percentage < 75) studentsBelow75++;
            if (doc.percentage >= 90) studentsAbove90++;
        }

        return {
            totalStudents: studentSet.size,
            totalClasses: classSet.size,
            averageAttendance: parseFloat((percentageSum / docs.length).toFixed(2)),
            studentsBelow75,
            studentsAbove90,
            departmentId,
            academicYear
        };
    } catch (error) {
        console.error('getDepartmentStats error:', error);
        return null;
    }
};

export {
    updateSummaryOnAttendance,
    updateSummaryOnApproval,
    getSummaryForStudent,
    getSummaryForClass,
    getStudentsBelowThreshold,
    getDepartmentStats
};

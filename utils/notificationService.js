/**
 * NOTIFICATION SERVICE
 * All functions write to Firestore notifications 
 * collection AND optionally send FCM push.
 * FCM failure never breaks Firestore write.
 * Always pass db as first parameter.
 */

import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * PRIVATE HELPER: Sends an FCM Push Notification safely.
 * @param {string|null} token FCM device token
 * @param {string} title Notification header
 * @param {string} body Notification message text
 */
const sendFCMPush = async (token, title, body) => {
    if (!token) return;
    try {
        await admin.messaging().send({
            token,
            notification: { title, body },
            android: { priority: 'high' },
            apns: { payload: { aps: { sound: 'default' } } }
        });
    } catch (error) {
        // FCM failure never breaks the notification flow
        console.error('FCM Push Failed:', error);
    }
};

/**
 * Alert teacher when student joins late
 */
const notifyStudentLate = async (db, teacherId, studentId, sessionId, attendanceId, classId, departmentId, minutesLate) => {
    try {
        const tDoc = await db.collection('teachers').doc(teacherId).get();
        const sDoc = await db.collection('students').doc(studentId).get();

        const title = 'Student Joined Late';
        const message = `${sDoc.data()?.name || 'Student'} (${sDoc.data()?.rollNumber || 'Unknown'}) joined ${minutesLate} minutes late and needs your approval`;

        const docRef = db.collection('notifications').doc();
        await docRef.set({
            notifId: docRef.id, recipientId: teacherId, recipientRole: 'teacher',
            type: 'student_late', title, message,
            sessionId, attendanceId, classId, studentId, departmentId,
            isRead: false, createdAt: FieldValue.serverTimestamp()
        });

        await sendFCMPush(tDoc.data()?.fcmToken, title, message);
        return docRef.id;
    } catch (error) {
        console.error('notifyStudentLate error:', error);
        throw error;
    }
};

/**
 * Warn student their attendance is low
 */
const notifyLowAttendance = async (db, studentId, classId, departmentId, subjectName, currentPercentage, minAttendance) => {
    try {
        const sDoc = await db.collection('students').doc(studentId).get();

        const title = 'Low Attendance Warning';
        const message = `Your attendance in ${subjectName} is ${currentPercentage}% which is below the required ${minAttendance}%. Please attend regularly.`;

        const docRef = db.collection('notifications').doc();
        await docRef.set({
            notifId: docRef.id, recipientId: studentId, recipientRole: 'student',
            type: 'low_attendance', title, message,
            classId, departmentId, isRead: false, createdAt: FieldValue.serverTimestamp()
        });

        await sendFCMPush(sDoc.data()?.fcmToken, title, message);
        return docRef.id;
    } catch (error) {
        console.error('notifyLowAttendance error:', error);
        throw error;
    }
};

/**
 * Tell teacher a student disputed their attendance
 */
const notifyDisputeRaised = async (db, teacherId, studentId, disputeId, classId, departmentId, subjectName, studentName) => {
    try {
        const tDoc = await db.collection('teachers').doc(teacherId).get();

        const title = 'Attendance Dispute Raised';
        const message = `${studentName} has raised a dispute regarding their attendance in ${subjectName}. Please review.`;

        const docRef = db.collection('notifications').doc();
        await docRef.set({
            notifId: docRef.id, recipientId: teacherId, recipientRole: 'teacher',
            type: 'dispute_raised', title, message,
            disputeId, classId, studentId, departmentId, isRead: false, createdAt: FieldValue.serverTimestamp()
        });

        await sendFCMPush(tDoc.data()?.fcmToken, title, message);
        return docRef.id;
    } catch (error) {
        console.error('notifyDisputeRaised error:', error);
        throw error;
    }
};

/**
 * Tell student their dispute was resolved
 */
const notifyDisputeResolved = async (db, studentId, disputeId, classId, departmentId, subjectName, resolution, teacherComment) => {
    try {
        const sDoc = await db.collection('students').doc(studentId).get();

        const isApproved = resolution === 'approved';
        const title = isApproved ? 'Dispute Approved ✓' : 'Dispute Rejected';
        const message = isApproved
            ? `Your attendance dispute for ${subjectName} has been approved. Your attendance has been updated.`
            : `Your attendance dispute for ${subjectName} was rejected. Reason: ${teacherComment}`;

        const docRef = db.collection('notifications').doc();
        await docRef.set({
            notifId: docRef.id, recipientId: studentId, recipientRole: 'student',
            type: 'dispute_resolved', title, message,
            disputeId, classId, departmentId, isRead: false, createdAt: FieldValue.serverTimestamp()
        });

        await sendFCMPush(sDoc.data()?.fcmToken, title, message);
        return docRef.id;
    } catch (error) {
        console.error('notifyDisputeResolved error:', error);
        throw error;
    }
};

/**
 * Tell student if teacher approved or rejected their late attendance
 */
const notifyAttendanceDecision = async (db, studentId, attendanceId, classId, departmentId, subjectName, approved) => {
    try {
        const sDoc = await db.collection('students').doc(studentId).get();

        const title = approved ? 'Attendance Approved ✓' : 'Attendance Rejected';
        const message = approved
            ? `Your late attendance for ${subjectName} has been approved by your teacher.`
            : `Your late attendance for ${subjectName} was not approved. You have been marked absent.`;

        const docRef = db.collection('notifications').doc();
        await docRef.set({
            notifId: docRef.id, recipientId: studentId, recipientRole: 'student',
            type: approved ? 'attendance_approved' : 'attendance_rejected', title, message,
            attendanceId, classId, departmentId, isRead: false, createdAt: FieldValue.serverTimestamp()
        });

        await sendFCMPush(sDoc.data()?.fcmToken, title, message);
        return docRef.id;
    } catch (error) {
        console.error('notifyAttendanceDecision error:', error);
        throw error;
    }
};

/**
 * Alert teacher AND HOD about fraud
 */
const notifyFraudDetected = async (db, teacherId, hodId, sessionId, classId, departmentId, flagType, suspectedStudentNames) => {
    try {
        const tDoc = await db.collection('teachers').doc(teacherId).get();
        const hDoc = hodId ? await db.collection('teachers').doc(hodId).get() : null;

        const title = 'Suspicious Activity Detected';
        const message = `Suspicious activity (${flagType}) detected in your session. Students involved: ${suspectedStudentNames}. Please review immediately.`;

        const notifIds = [];
        const batch = db.batch();

        const appendNotif = (recipId, recipRole, token) => {
            const docRef = db.collection('notifications').doc();
            batch.set(docRef, {
                notifId: docRef.id, recipientId: recipId, recipientRole: recipRole,
                type: 'fraud_detected', title, message,
                sessionId, classId, departmentId, isRead: false, createdAt: FieldValue.serverTimestamp()
            });
            notifIds.push(docRef.id);
            sendFCMPush(token, title, message); // intentionally not awaited
        };

        appendNotif(teacherId, 'teacher', tDoc.data()?.fcmToken);
        if (hodId && hDoc?.exists) {
            appendNotif(hodId, 'hod', hDoc.data()?.fcmToken);
        }

        await batch.commit();
        return notifIds;
    } catch (error) {
        console.error('notifyFraudDetected error:', error);
        throw error;
    }
};

/**
 * Get count of unread notifications for badge
 */
const getUnreadCount = async (db, recipientId) => {
    try {
        const snapshot = await db.collection('notifications')
            .where('recipientId', '==', recipientId)
            .where('isRead', '==', false)
            .count().get();
        return snapshot.data().count;
    } catch (error) {
        console.error('getUnreadCount error:', error);
        return 0;
    }
};

/**
 * Mark one notification as read
 */
const markAsRead = async (db, notifId) => {
    try {
        await db.collection('notifications').doc(notifId).update({ isRead: true });
        return true;
    } catch (error) {
        console.error('markAsRead error:', error);
        return false;
    }
};

/**
 * Mark all notifications as read for a user 
 */
const markAllAsRead = async (db, recipientId) => {
    try {
        const snapshot = await db.collection('notifications')
            .where('recipientId', '==', recipientId)
            .where('isRead', '==', false)
            .get();

        if (snapshot.empty) return 0;

        let updatedCount = 0;
        let batch = db.batch();
        let currentBatchSize = 0;

        for (const doc of snapshot.docs) {
            batch.update(doc.ref, { isRead: true });
            updatedCount++;
            currentBatchSize++;

            if (currentBatchSize === 400) {
                await batch.commit();
                batch = db.batch();
                currentBatchSize = 0;
            }
        }

        if (currentBatchSize > 0) {
            await batch.commit();
        }

        return updatedCount;
    } catch (error) {
        console.error('markAllAsRead error:', error);
        throw error;
    }
};

export {
    notifyStudentLate,
    notifyLowAttendance,
    notifyDisputeRaised,
    notifyDisputeResolved,
    notifyAttendanceDecision,
    notifyFraudDetected,
    getUnreadCount,
    markAsRead,
    markAllAsRead
};

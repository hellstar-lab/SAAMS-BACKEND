/**
 * FRAUD DETECTOR
 * Runs during attendance marking to catch cheating.
 * checkDuplicateDevice and checkRapidScan run BEFORE
 * writing attendance (blocking checks).
 * checkGPSProximity runs AFTER writing attendance
 * (non-blocking, just flags for review).
 * Never let fraud checks crash the attendance flow.
 */

import { FieldValue } from 'firebase-admin/firestore';

/**
 * Calculates distance between two given coordinates in meters
 */
const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Checks if a deviceId was already used by a DIFFERENT student in this session.
 */
const checkDuplicateDevice = async (db, deviceId, studentId, studentName, sessionId, classId, departmentId) => {
    try {
        if (!deviceId) return { isFraud: false };

        const snap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('deviceId', '==', deviceId)
            .where('studentId', '!=', studentId)
            .limit(1).get();

        if (!snap.empty) {
            const existing = snap.docs[0].data();
            const existingName = existing.studentName || 'Unknown Student';

            const docRef = db.collection('fraudFlags').doc();
            await docRef.set({
                flagId: docRef.id,
                type: 'duplicate_device',
                sessionId, classId, departmentId,
                suspectedStudents: [existing.studentId, studentId],
                suspectedStudentNames: [existingName, studentName],
                details: { deviceId, firstStudentId: existing.studentId, secondStudentId: studentId, sessionId },
                status: 'pending',
                autoAction: 'blocked',
                createdAt: FieldValue.serverTimestamp()
            });

            return {
                isFraud: true, type: 'duplicate_device', flagId: docRef.id,
                message: 'Device already used by another student in this session'
            };
        }

        return { isFraud: false };
    } catch (error) {
        console.error('checkDuplicateDevice error:', error);
        return { isFraud: false };
    }
};

/**
 * Checks if another student marked attendance from < 2m away in this session.
 */
const checkGPSProximity = async (db, studentId, studentName, studentLat, studentLng, sessionId, classId, departmentId) => {
    try {
        if (!studentLat || !studentLng) return { isFraud: false };

        const snap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('studentId', '!=', studentId)
            .where('method', '==', 'gps')
            .get();

        for (const doc of snap.docs) {
            const other = doc.data();
            if (!other.studentLat || !other.studentLng) continue;

            const distance = haversineMeters(studentLat, studentLng, other.studentLat, other.studentLng);

            if (distance <= 2) {
                const docRef = db.collection('fraudFlags').doc();
                await docRef.set({
                    flagId: docRef.id,
                    type: 'gps_proximity',
                    sessionId, classId, departmentId,
                    suspectedStudents: [other.studentId, studentId],
                    suspectedStudentNames: [other.studentName || 'Unknown', studentName],
                    details: {
                        student1: { id: other.studentId, lat: other.studentLat, lng: other.studentLng },
                        student2: { id: studentId, lat: studentLat, lng: studentLng },
                        distanceMeters: distance
                    },
                    status: 'pending',
                    autoAction: 'flagged',
                    createdAt: FieldValue.serverTimestamp()
                });

                return {
                    isFraud: true, type: 'gps_proximity', flagId: docRef.id, distanceMeters: distance,
                    message: 'Student GPS location is suspiciously close to another student'
                };
            }
        }
        return { isFraud: false };
    } catch (error) {
        console.error('checkGPSProximity error:', error);
        return { isFraud: false };
    }
};

/**
 * Rapid scan detection to block replay-attacks / accidental double-taps within 10 seconds.
 */
const checkRapidScan = async (db, studentId, sessionId) => {
    try {
        const snap = await db.collection('attendance')
            .where('sessionId', '==', sessionId)
            .where('studentId', '==', studentId)
            .limit(1).get();

        if (!snap.empty) {
            const existing = snap.docs[0].data();
            if (existing.joinedAt) {
                // Determine the joined time in ms
                const joinedMs = existing.joinedAt.toMillis ? existing.joinedAt.toMillis() : new Date(existing.joinedAt).getTime();
                const nowMs = Date.now();

                if ((nowMs - joinedMs) <= 10000) {
                    return {
                        isFraud: true, type: 'rapid_scan',
                        message: 'Duplicate scan detected — please wait before trying again'
                    };
                }
            }
        }

        return { isFraud: false };
    } catch (error) {
        console.error('checkRapidScan error:', error);
        return { isFraud: false };
    }
};

/**
 * Load fraud issues tied directly to a specific session.
 */
const getFraudFlagsForSession = async (db, sessionId) => {
    try {
        const snap = await db.collection('fraudFlags')
            .where('sessionId', '==', sessionId)
            .orderBy('createdAt', 'desc')
            .get();
        return snap.empty ? [] : snap.docs.map(doc => doc.data());
    } catch (error) {
        console.error('getFraudFlagsForSession error:', error);
        return [];
    }
};

/**
 * Load fraud cases scoped across an entire department filterable by status.
 */
const getFraudFlagsForDepartment = async (db, departmentId, status) => {
    try {
        const snap = await db.collection('fraudFlags')
            .where('departmentId', '==', departmentId)
            .where('status', '==', status)
            .orderBy('createdAt', 'desc')
            .get();
        return snap.empty ? [] : snap.docs.map(doc => doc.data());
    } catch (error) {
        console.error('getFraudFlagsForDepartment error:', error);
        return [];
    }
};

/**
 * Manually update the outcome of a suspected fraud dispute.
 */
const reviewFraudFlag = async (db, flagId, reviewedBy, decision) => {
    try {
        await db.collection('fraudFlags').doc(flagId).update({
            status: decision,
            reviewedBy,
            reviewedAt: FieldValue.serverTimestamp()
        });
        return true;
    } catch (error) {
        console.error('reviewFraudFlag error:', error);
        return false;
    }
};

/**
 * Quickly pull the count of pending reviews across a department for the HOD Dashboard badge.
 */
const getPendingFraudCount = async (db, departmentId) => {
    try {
        const snap = await db.collection('fraudFlags')
            .where('departmentId', '==', departmentId)
            .where('status', '==', 'pending')
            .count().get();
        return snap.data().count;
    } catch (error) {
        console.error('getPendingFraudCount error:', error);
        return 0;
    }
};

export {
    checkDuplicateDevice,
    checkGPSProximity,
    checkRapidScan,
    getFraudFlagsForSession,
    getFraudFlagsForDepartment,
    reviewFraudFlag,
    getPendingFraudCount
};

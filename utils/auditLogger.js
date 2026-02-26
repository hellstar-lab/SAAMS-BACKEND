/**
 * AUDIT LOGGER — Do not modify logged documents.
 * All entries are immutable records for compliance.
 */

import { FieldValue } from 'firebase-admin/firestore';

/**
 * Valid action types for the audit log.
 */
const ACTIONS = {
    ATTENDANCE_MARKED: 'attendance_marked',
    ATTENDANCE_APPROVED: 'attendance_approved',
    ATTENDANCE_REJECTED: 'attendance_rejected',
    ATTENDANCE_MANUAL: 'attendance_manual',
    SESSION_STARTED: 'session_started',
    SESSION_ENDED: 'session_ended',
    STUDENT_ADDED: 'student_added',
    STUDENT_REMOVED: 'student_removed',
    AUTO_ABSENT: 'auto_absent',
    FRAUD_DETECTED: 'fraud_detected',
    FRAUD_REVIEWED: 'fraud_reviewed',
    DISPUTE_RAISED: 'dispute_raised',
    DISPUTE_RESOLVED: 'dispute_resolved',
    FACE_ENROLLED: 'face_enrolled',
    FACE_FAILED: 'face_failed',
    ACCOUNT_CREATED: 'account_created',
    ACCOUNT_DEACTIVATED: 'account_deactivated',
    HOD_ASSIGNED: 'hod_assigned',
    DEPARTMENT_CREATED: 'department_created',
    CLASS_CREATED: 'class_created',
    CLASS_ARCHIVED: 'class_archived',
    LOW_ATTENDANCE_ALERT: 'low_attendance_alert'
};

/**
 * Valid actor roles who can trigger an action.
 */
const ACTOR_ROLES = {
    SUPER_ADMIN: 'superAdmin',
    HOD: 'hod',
    TEACHER: 'teacher',
    STUDENT: 'student',
    SYSTEM: 'system'
};

/**
 * Valid targets that an action can affect.
 */
const TARGET_TYPES = {
    ATTENDANCE: 'attendance',
    SESSION: 'session',
    CLASS: 'class',
    STUDENT: 'student',
    TEACHER: 'teacher',
    DISPUTE: 'dispute',
    DEPARTMENT: 'department',
    FRAUD_FLAG: 'fraudFlag'
};

/**
 * Utility to filter out null or undefined values from details object.
 *
 * @param {Object} obj Key-value pairs to include in details
 * @returns {Object} Filtered object with only defined non-null values
 */
const createDetails = (obj) => {
    const details = {};
    for (const [key, value] of Object.entries(obj || {})) {
        if (value !== undefined && value !== null) {
            details[key] = value;
        }
    }
    return details;
};

/**
 * Logs an important action to the immutable audit_logs collection.
 * This is designed as fire-and-forget; do NOT await this in your controllers.
 * 
 * USAGE EXAMPLES:
 * 
 * // Mark attendance
 * logAction(db, ACTIONS.ATTENDANCE_MARKED, studentId, 
 *   ACTOR_ROLES.STUDENT, attendanceId, TARGET_TYPES.ATTENDANCE,
 *   createDetails({ faceScore, method, sessionId, status }),
 *   departmentId, req.ip);
 * 
 * // Approve late student  
 * logAction(db, ACTIONS.ATTENDANCE_APPROVED, teacherId,
 *   ACTOR_ROLES.TEACHER, attendanceId, TARGET_TYPES.ATTENDANCE,
 *   createDetails({ oldStatus: 'late', newStatus: 'present', 
 *   studentId }), departmentId, req.ip);
 * 
 * // Fraud detected
 * logAction(db, ACTIONS.FRAUD_DETECTED, 'system',
 *   ACTOR_ROLES.SYSTEM, attendanceId, TARGET_TYPES.ATTENDANCE,
 *   createDetails({ deviceId, reason: 'duplicate_device', 
 *   suspectedStudents }), departmentId, null);
 *
 * @param {Object} db Firestore instance
 * @param {string} action Action string from ACTIONS
 * @param {string} actorId UID of the user/system causing the action
 * @param {string} actorRole Role of the actor from ACTOR_ROLES
 * @param {string} targetId Document ID affected by the action
 * @param {string} targetType Collection or Entity type from TARGET_TYPES
 * @param {Object} [details={}] Action-specific extra data
 * @param {string|null} [departmentId=null] Department ID for filtering
 * @param {string|null} [ipAddress=null] Originating IP
 * @returns {Promise<boolean>} true on success, false on failure
 */
const logAction = async (db, action, actorId, actorRole, targetId, targetType, details = {}, departmentId = null, ipAddress = null) => {
    try {
        const docRef = db.collection('audit_logs').doc();
        const logId = docRef.id;

        await docRef.set({
            logId,
            action,
            actorId,
            actorRole,
            targetId,
            targetType,
            details,
            departmentId,
            ipAddress,
            timestamp: FieldValue.serverTimestamp()
        });

        return true;
    } catch (error) {
        console.error('Audit Log Error:', error);
        return false;
    }
};

// Exporting using ESM syntax (export {}) since package.json has "type": "module"
export { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES };

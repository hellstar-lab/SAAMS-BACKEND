import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js';
import { getDepartmentStats } from '../utils/summaryUpdater.js';

// SUPER ADMIN CONTROLLER
// System-wide management and oversight.
// Every function requires superAdmin role.
// This powers the admin dashboard shown to
// college decision-makers during the demo.
// Provides system stats, user management,
// department overview, and audit access.

// ━━━ PRIVATE HELPER FUNCTIONS ━━━
const getCurrentAcademicYear = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (month >= 7) {
        return year + '-' + String(year + 1).slice(-2);
    } else {
        return (year - 1) + '-' + String(year).slice(-2);
    }
};

const getTodayStart = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
};

// ━━━ getSystemOverview ━━━
const getSystemOverview = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const todayStart = getTodayStart();

        const [
            departmentsSnap,
            teachersSnap,
            studentsSnap,
            activeSessionsSnap,
            todayAttendanceSnap,
            pendingDisputesSnap,
            pendingFraudSnap,
            totalClassesSnap
        ] = await Promise.all([
            db.collection('departments').where('isActive', '==', true).get(),
            db.collection('teachers').where('isActive', '==', true).get(),
            db.collection('students').where('isActive', '==', true).get(),
            db.collection('sessions').where('status', '==', 'active').get(),
            db.collection('attendance').where('createdAt', '>=', todayStart).get(),
            db.collection('disputes').where('status', '==', 'pending').get(),
            db.collection('fraudFlags').where('status', '==', 'pending').get(),
            db.collection('classes').where('isActive', '==', true).get()
        ]);

        const departmentBreakdown = departmentsSnap.docs.map(doc => {
            const d = doc.data();
            return {
                departmentId: doc.id,
                name: d.name,
                code: d.code,
                hodName: d.hodName || 'Not Assigned',
                totalTeachers: d.totalTeachers || 0,
                totalStudents: d.totalStudents || 0,
                totalClasses: d.totalClasses || 0,
                minAttendance: d.minAttendance || 75
            };
        });

        const methodBreakdown = {
            qrcode: 0, gps: 0,
            network: 0, bluetooth: 0
        };
        todayAttendanceSnap.docs.forEach(doc => {
            const method = doc.data().method;
            if (methodBreakdown[method] !== undefined) {
                methodBreakdown[method]++;
            }
        });

        return res.status(200).json({
            success: true,
            data: {
                systemCounts: {
                    totalDepartments: departmentsSnap.size,
                    totalTeachers: teachersSnap.size,
                    totalStudents: studentsSnap.size,
                    totalClasses: totalClassesSnap.size,
                    activeSessionsNow: activeSessionsSnap.size,
                    attendanceMarkedToday: todayAttendanceSnap.size
                },
                pendingActions: {
                    disputesPending: pendingDisputesSnap.size,
                    fraudFlagsPending: pendingFraudSnap.size,
                    total: pendingDisputesSnap.size + pendingFraudSnap.size
                },
                todayMethodBreakdown: methodBreakdown,
                departmentBreakdown,
                academicYear: getCurrentAcademicYear(),
                generatedAt: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('getSystemOverview error:', error);
        next(error);
    }
};

// ━━━ getAllDepartmentsDetailed ━━━
const getAllDepartmentsDetailed = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const deptsSnap = await db.collection('departments')
            .orderBy('name', 'asc').get();

        const statsPromises = deptsSnap.docs.map(doc =>
            getDepartmentStats(
                db,
                doc.id,
                getCurrentAcademicYear()
            )
        );
        const allStats = await Promise.all(statsPromises);

        const departments = deptsSnap.docs.map(
            (doc, index) => ({
                ...doc.data(),
                attendanceStats: allStats[index] || {
                    averageAttendance: 0,
                    studentsBelow75: 0,
                    studentsAbove90: 0
                }
            })
        );

        return res.status(200).json({
            success: true,
            data: departments,
            count: departments.length
        });
    } catch (error) {
        console.error('getAllDepartmentsDetailed error:', error);
        next(error);
    }
};

// ━━━ getAllTeachers ━━━
const getAllTeachers = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const { departmentId, isActive, isHod, limit } = req.query;

        let query = db.collection('teachers');

        if (departmentId) {
            query = query.where('departmentId', '==', departmentId);
        }

        if (isActive !== undefined) {
            query = query.where('isActive', '==', isActive !== 'false');
        }

        if (isHod === 'true') {
            query = query.where('isHod', '==', true);
        }

        query = query.orderBy('name', 'asc').limit(parseInt(limit) || 100);

        const teachersSnap = await query.get();
        const teachers = teachersSnap.docs.map(doc => doc.data());

        return res.status(200).json({
            success: true,
            data: teachers.map(t => ({
                teacherId: t.teacherId,
                name: t.name,
                email: t.email,
                employeeId: t.employeeId,
                departmentId: t.departmentId,
                departmentName: t.departmentName,
                designation: t.designation,
                isHod: t.isHod,
                role: t.role,
                isActive: t.isActive,
                lastLoginAt: t.lastLoginAt,
                createdAt: t.createdAt
            })),
            count: teachers.length
        });
    } catch (error) {
        console.error('getAllTeachers error:', error);
        next(error);
    }
};

// ━━━ getAllStudents ━━━
const getAllStudents = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const { departmentId, semester, section, isActive, faceRegistered, limit } = req.query;

        let query = db.collection('students');

        if (departmentId) {
            query = query.where('departmentId', '==', departmentId);
        }
        if (semester) {
            query = query.where('semester', '==', parseInt(semester));
        }
        if (section) {
            query = query.where('section', '==', section.toUpperCase());
        }
        if (isActive !== undefined) {
            query = query.where('isActive', '==', isActive !== 'false');
        }
        if (faceRegistered !== undefined) {
            query = query.where('faceRegistered', '==', faceRegistered === 'true');
        }

        query = query.orderBy('name', 'asc').limit(parseInt(limit) || 200);

        const studentsSnap = await query.get();
        const students = studentsSnap.docs.map(doc => doc.data());

        return res.status(200).json({
            success: true,
            data: students.map(s => ({
                studentId: s.studentId,
                name: s.name,
                email: s.email,
                rollNumber: s.rollNumber,
                departmentId: s.departmentId,
                departmentName: s.departmentName,
                semester: s.semester,
                section: s.section,
                batch: s.batch,
                faceRegistered: s.faceRegistered,
                isActive: s.isActive,
                attendanceWarned: s.attendanceWarned,
                lastLoginAt: s.lastLoginAt,
                createdAt: s.createdAt
            })),
            count: students.length
        });
    } catch (error) {
        console.error('getAllStudents error:', error);
        next(error);
    }
};

// ━━━ getActiveSessions ━━━
const getActiveSessions = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const sessionsSnap = await db
            .collection('sessions')
            .where('status', '==', 'active')
            .orderBy('startTime', 'desc')
            .get();

        const sessionData = await Promise.all(
            sessionsSnap.docs.map(async doc => {
                const session = doc.data();
                const attendanceSnap = await db
                    .collection('attendance')
                    .where('sessionId', '==', doc.id)
                    .get();

                const present = attendanceSnap.docs
                    .filter(a => a.data().status === 'present'
                        || (a.data().status === 'late' && a.data().teacherApproved === true))
                    .length;

                const late = attendanceSnap.docs
                    .filter(a => a.data().status === 'late' && a.data().teacherApproved === null)
                    .length;

                return {
                    sessionId: doc.id,
                    teacherName: session.teacherName,
                    subjectName: session.subjectName,
                    departmentId: session.departmentId,
                    method: session.method,
                    totalEnrolled: session.totalStudents || 0,
                    markedPresent: present,
                    awaitingApproval: late,
                    notYetMarked: (session.totalStudents || 0) - attendanceSnap.size,
                    startTime: session.startTime,
                    roomNumber: session.roomNumber || null,
                    buildingName: session.buildingName || null
                };
            })
        );

        return res.status(200).json({
            success: true,
            data: sessionData,
            count: sessionData.length,
            message: sessionData.length === 0 ?
                'No active sessions right now' :
                sessionData.length + ' session(s) running now'
        });
    } catch (error) {
        console.error('getActiveSessions error:', error);
        next(error);
    }
};

// ━━━ getSystemFraudOverview ━━━
const getSystemFraudOverview = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const [
            pendingFlagsSnap,
            allFlagsSnap,
            suspiciousAttendanceSnap
        ] = await Promise.all([
            db.collection('fraudFlags').where('status', '==', 'pending').get(),
            db.collection('fraudFlags').orderBy('createdAt', 'desc').limit(20).get(),
            db.collection('attendance').where('isSuspicious', '==', true).orderBy('createdAt', 'desc').limit(20).get()
        ]);

        const typeBreakdown = {};
        allFlagsSnap.docs.forEach(doc => {
            const type = doc.data().type;
            typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
        });

        return res.status(200).json({
            success: true,
            data: {
                summary: {
                    totalPendingFlags: pendingFlagsSnap.size,
                    totalFlagsEver: allFlagsSnap.size,
                    suspiciousAttendanceCount: suspiciousAttendanceSnap.size,
                    typeBreakdown
                },
                recentFlags: allFlagsSnap.docs.map(doc => doc.data()),
                recentSuspicious: suspiciousAttendanceSnap.docs.map(doc => ({
                    attendanceId: doc.id,
                    studentName: doc.data().studentName,
                    sessionId: doc.data().sessionId,
                    suspiciousReason: doc.data().suspiciousReason,
                    departmentId: doc.data().departmentId,
                    createdAt: doc.data().createdAt
                }))
            }
        });
    } catch (error) {
        console.error('getSystemFraudOverview error:', error);
        next(error);
    }
};

// ━━━ getAuditLogs ━━━
const getAuditLogs = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const { action, actorRole, departmentId, limit, startDate, endDate } = req.query;

        let query = db.collection('audit_logs');

        if (action) {
            query = query.where('action', '==', action);
        }
        if (actorRole) {
            query = query.where('actorRole', '==', actorRole);
        }
        if (departmentId) {
            query = query.where('departmentId', '==', departmentId);
        }
        if (startDate) {
            query = query.where('timestamp', '>=', new Date(startDate));
        }
        if (endDate) {
            query = query.where('timestamp', '<=', new Date(endDate));
        }

        query = query.orderBy('timestamp', 'desc').limit(parseInt(limit) || 50);

        const logsSnap = await query.get();
        const logs = logsSnap.docs.map(doc => doc.data());

        return res.status(200).json({
            success: true,
            data: logs,
            count: logs.length
        });
    } catch (error) {
        console.error('getAuditLogs error:', error);
        next(error);
    }
};

// ━━━ getUserDetails ━━━
const getUserDetails = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const { uid } = req.params;

        const [teacherDoc, studentDoc] = await Promise.all([
            db.collection('teachers').doc(uid).get(),
            db.collection('students').doc(uid).get()
        ]);

        let userData = null;
        let collection = null;

        if (teacherDoc.exists) {
            userData = teacherDoc.data();
            collection = 'teachers';
        } else if (studentDoc.exists) {
            userData = studentDoc.data();
            collection = 'students';
        }

        if (!userData) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        const auditSnap = await db
            .collection('audit_logs')
            .where('actorId', '==', uid)
            .orderBy('timestamp', 'desc')
            .limit(10)
            .get();

        return res.status(200).json({
            success: true,
            data: {
                profile: {
                    ...userData,
                    faceDescriptor: undefined,
                    fcmToken: undefined
                },
                collection,
                recentActivity: auditSnap.docs.map(doc => ({
                    action: doc.data().action,
                    targetType: doc.data().targetType,
                    timestamp: doc.data().timestamp
                }))
            }
        });

    } catch (error) {
        console.error('getUserDetails error:', error);
        next(error);
    }
};

// ━━━ getSystemStats ━━━
const getSystemStats = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const year = req.query.academicYear || getCurrentAcademicYear();

        const deptsSnap = await db
            .collection('departments')
            .where('isActive', '==', true).get();

        const allDeptStats = await Promise.all(
            deptsSnap.docs.map(doc =>
                getDepartmentStats(db, doc.id, year)
            )
        );

        const validStats = allDeptStats.filter(s => s !== null);

        const totalStudentsTracked = validStats.reduce((sum, s) => sum + (s.totalStudents || 0), 0);

        const systemAverage = validStats.length > 0 ?
            (validStats.reduce((sum, s) => sum + (s.averageAttendance || 0), 0) / validStats.length).toFixed(2) : 0;

        const totalBelow75 = validStats.reduce((sum, s) => sum + (s.studentsBelow75 || 0), 0);

        const totalAbove90 = validStats.reduce((sum, s) => sum + (s.studentsAbove90 || 0), 0);

        return res.status(200).json({
            success: true,
            data: {
                academicYear: year,
                systemWide: {
                    totalDepartments: deptsSnap.size,
                    totalStudentsTracked,
                    systemAverageAttendance: parseFloat(systemAverage),
                    studentsBelow75: totalBelow75,
                    studentsAbove90: totalAbove90
                },
                byDepartment: deptsSnap.docs.map((doc, i) => ({
                    departmentId: doc.id,
                    departmentName: doc.data().name,
                    code: doc.data().code,
                    stats: allDeptStats[i] || {
                        averageAttendance: 0,
                        studentsBelow75: 0,
                        studentsAbove90: 0,
                        totalStudents: 0
                    }
                }))
            }
        });
    } catch (error) {
        console.error('getSystemStats error:', error);
        next(error);
    }
};

// ━━━ getPendingActions ━━━
const getPendingActions = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return res.status(403).json({
                success: false,
                error: 'Super admin access required',
                code: 'SUPER_ADMIN_ONLY'
            });
        }

        const [
            disputesSnap,
            fraudSnap,
            teachersNoDeptSnap,
            studentsNoDeptSnap
        ] = await Promise.all([
            db.collection('disputes')
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .limit(10).get(),
            db.collection('fraudFlags')
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .limit(10).get(),
            db.collection('teachers')
                .where('departmentId', '==', null)
                .where('isActive', '==', true)
                .limit(20).get(),
            db.collection('students')
                .where('departmentId', '==', null)
                .where('isActive', '==', true)
                .limit(20).get()
        ]);

        return res.status(200).json({
            success: true,
            data: {
                summary: {
                    pendingDisputes: disputesSnap.size,
                    pendingFraudFlags: fraudSnap.size,
                    teachersWithoutDepartment: teachersNoDeptSnap.size,
                    studentsWithoutDepartment: studentsNoDeptSnap.size,
                    totalActionItems:
                        disputesSnap.size + fraudSnap.size +
                        teachersNoDeptSnap.size +
                        studentsNoDeptSnap.size
                },
                pendingDisputes: disputesSnap.docs.map(doc => ({
                    disputeId: doc.id,
                    studentName: doc.data().studentName,
                    subjectName: doc.data().subjectName,
                    teacherName: doc.data().teacherName,
                    createdAt: doc.data().createdAt
                })),
                pendingFraudFlags: fraudSnap.docs.map(doc => ({
                    flagId: doc.id,
                    type: doc.data().type,
                    departmentId: doc.data().departmentId,
                    createdAt: doc.data().createdAt
                })),
                teachersNeedingDepartment: teachersNoDeptSnap.docs.map(doc => ({
                    teacherId: doc.id,
                    name: doc.data().name,
                    email: doc.data().email,
                    employeeId: doc.data().employeeId
                })),
                studentsNeedingDepartment: studentsNoDeptSnap.docs.map(doc => ({
                    studentId: doc.id,
                    name: doc.data().name,
                    rollNumber: doc.data().rollNumber
                }))
            }
        });

    } catch (error) {
        console.error('getPendingActions error:', error);
        next(error);
    }
};

export {
    getSystemOverview,
    getAllDepartmentsDetailed,
    getAllTeachers,
    getAllStudents,
    getActiveSessions,
    getSystemFraudOverview,
    getAuditLogs,
    getUserDetails,
    getSystemStats,
    getPendingActions
};

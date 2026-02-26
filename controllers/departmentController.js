/**
 * DEPARTMENT CONTROLLER
 * Manages university departments.
 * Most write operations: superAdmin only.
 * Read operations: role-based access.
 * HOD assignment automatically updates 
 * teacher role in teachers collection.
 */

import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js';
import { getDepartmentStats as getSummaryStats } from '../utils/summaryUpdater.js';

// ─── Shared Response Handlers ───
const successResponse = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const errorResponse = (res, message, status = 400, code = 'ERROR') => res.status(status).json({ success: false, error: message, code });

// ━━━ 1: CREATE DEPARTMENT ━━━
export const createDepartment = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') {
            return errorResponse(res, 'Only superAdmin can create departments', 403, 'SUPER_ADMIN_ONLY');
        }

        const { name, code, minAttendance } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return errorResponse(res, 'Valid department name is required (min 2 chars)', 400, 'MISSING_FIELDS');
        }
        if (!code || typeof code !== 'string' || code.trim().length > 10) {
            return errorResponse(res, 'Valid department code is required (max 10 chars)', 400, 'MISSING_FIELDS');
        }

        const upperCode = code.trim().toUpperCase();

        const existingSnap = await db.collection('departments').where('code', '==', upperCode).get();
        if (!existingSnap.empty) {
            return errorResponse(res, `Department code ${upperCode} already exists`, 409, 'DEPARTMENT_CODE_EXISTS');
        }

        const deptRef = db.collection('departments').doc();
        const departmentId = deptRef.id;

        const newDept = {
            departmentId,
            name: name.trim(),
            code: upperCode,
            hodId: null,
            hodName: null,
            minAttendance: minAttendance || 75,
            totalTeachers: 0,
            totalStudents: 0,
            totalClasses: 0,
            isActive: true,
            createdBy: req.user.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        await deptRef.set(newDept);

        logAction(
            db, ACTIONS.DEPARTMENT_CREATED, req.user.uid, ACTOR_ROLES.SYSTEM,
            departmentId, TARGET_TYPES.DEPARTMENT, createDetails({ name: newDept.name, code: newDept.code }),
            departmentId, req.ip
        ).catch(console.error);

        return successResponse(res, {
            data: { departmentId, name: newDept.name, code: newDept.code },
            message: 'Department created successfully'
        }, 201);
    } catch (error) {
        console.error('createDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to create department', 500, 'SERVER_ERROR');
    }
};

// ━━━ 2: GET ALL DEPARTMENTS ━━━
export const getAllDepartments = async (req, res, next) => {
    try {
        const snap = await db.collection('departments')
            .where('isActive', '==', true)
            .orderBy('name', 'asc')
            .get();

        const departments = snap.docs.map(doc => doc.data());
        let data = departments;

        if (req.user.role !== 'superAdmin') {
            data = departments.map(d => ({
                departmentId: d.departmentId,
                name: d.name,
                code: d.code
            }));
        }

        return successResponse(res, { data, count: data.length });
    } catch (error) {
        console.error('getAllDepartments error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to fetch departments', 500, 'SERVER_ERROR');
    }
};

// ━━━ 3: GET DEPARTMENT BY ID ━━━
export const getDepartmentById = async (req, res, next) => {
    try {
        const { departmentId } = req.params;
        const deptDoc = await db.collection('departments').doc(departmentId).get();

        if (!deptDoc.exists) return errorResponse(res, 'Department not found', 404, 'NOT_FOUND');
        const deptData = deptDoc.data();

        if (req.user.role !== 'superAdmin' && req.user.departmentId !== departmentId) {
            return errorResponse(res, 'Not authorized for this department', 403, 'UNAUTHORIZED');
        }

        const [teachersSnap, studentsSnap, classesSnap] = await Promise.all([
            db.collection('teachers').where('departmentId', '==', departmentId).where('isActive', '==', true).count().get(),
            db.collection('students').where('departmentId', '==', departmentId).where('isActive', '==', true).count().get(),
            db.collection('classes').where('departmentId', '==', departmentId).where('isActive', '==', true).count().get()
        ]);

        return successResponse(res, {
            data: {
                ...deptData,
                createdAt: deptData.createdAt?.toDate?.()?.toISOString(),
                updatedAt: deptData.updatedAt?.toDate?.()?.toISOString(),
                liveCounts: {
                    teachers: teachersSnap.data().count,
                    students: studentsSnap.data().count,
                    classes: classesSnap.data().count
                }
            }
        });
    } catch (error) {
        console.error('getDepartmentById error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to fetch department details', 500, 'SERVER_ERROR');
    }
};

// ━━━ 4: ASSIGN HOD ━━━
export const assignHod = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') return errorResponse(res, 'Only superAdmin can assign HOD', 403, 'SUPER_ADMIN_ONLY');

        const { departmentId } = req.params;
        const { teacherId } = req.body;

        if (!teacherId) return errorResponse(res, 'teacherId is required', 400, 'MISSING_FIELDS');

        const [deptDoc, teacherDoc] = await Promise.all([
            db.collection('departments').doc(departmentId).get(),
            db.collection('teachers').doc(teacherId).get()
        ]);

        if (!deptDoc.exists || !deptDoc.data().isActive) return errorResponse(res, 'Department not found or inactive', 404, 'NOT_FOUND');
        if (!teacherDoc.exists || !teacherDoc.data().isActive) return errorResponse(res, 'Teacher not found or inactive', 404, 'NOT_FOUND');

        const deptData = deptDoc.data();
        const teacherData = teacherDoc.data();

        if (teacherData.departmentId !== departmentId) {
            return errorResponse(res, 'Teacher must belong to the same department to be HOD', 400, 'TEACHER_WRONG_DEPARTMENT');
        }

        const batch = db.batch();

        if (deptData.hodId) {
            const oldHodRef = db.collection('teachers').doc(deptData.hodId);
            batch.update(oldHodRef, {
                isHod: false,
                role: 'teacher',
                updatedAt: FieldValue.serverTimestamp()
            });
        }

        batch.update(teacherDoc.ref, {
            isHod: true,
            role: 'hod',
            updatedAt: FieldValue.serverTimestamp()
        });

        batch.update(deptDoc.ref, {
            hodId: teacherId,
            hodName: teacherData.name,
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logAction(
            db, ACTIONS.HOD_ASSIGNED, req.user.uid, ACTOR_ROLES.SYSTEM,
            departmentId, TARGET_TYPES.DEPARTMENT,
            createDetails({ teacherId, teacherName: teacherData.name, departmentId, previousHodId: deptData.hodId || null }),
            departmentId, req.ip
        ).catch(console.error);

        return successResponse(res, { message: `${teacherData.name} assigned as HOD of ${deptData.name}` });
    } catch (error) {
        console.error('assignHod error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to assign HOD', 500, 'SERVER_ERROR');
    }
};

// ━━━ 5: REMOVE HOD ━━━
export const removeHod = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') return errorResponse(res, 'Only superAdmin can remove HOD', 403, 'SUPER_ADMIN_ONLY');

        const { departmentId } = req.params;
        const deptDoc = await db.collection('departments').doc(departmentId).get();

        if (!deptDoc.exists) return errorResponse(res, 'Department not found', 404, 'NOT_FOUND');
        const deptData = deptDoc.data();

        if (!deptData.hodId) return errorResponse(res, 'Department has no HOD assigned', 400, 'NO_HOD_ASSIGNED');

        const batch = db.batch();

        const oldHodRef = db.collection('teachers').doc(deptData.hodId);
        batch.update(oldHodRef, {
            isHod: false,
            role: 'teacher',
            updatedAt: FieldValue.serverTimestamp()
        });

        batch.update(deptDoc.ref, {
            hodId: null,
            hodName: null,
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logAction(
            db, ACTIONS.HOD_ASSIGNED, req.user.uid, ACTOR_ROLES.SYSTEM,
            departmentId, TARGET_TYPES.DEPARTMENT, createDetails({ removedHodId: deptData.hodId }),
            departmentId, req.ip
        ).catch(console.error);

        return successResponse(res, { message: 'HOD removed successfully' });
    } catch (error) {
        console.error('removeHod error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to remove HOD', 500, 'SERVER_ERROR');
    }
};

// ━━━ 6: UPDATE DEPARTMENT ━━━
export const updateDepartment = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') return errorResponse(res, 'Only superAdmin can update departments', 403, 'SUPER_ADMIN_ONLY');

        const { departmentId } = req.params;
        const { name, minAttendance } = req.body;

        const deptDoc = await db.collection('departments').doc(departmentId).get();
        if (!deptDoc.exists) return errorResponse(res, 'Department not found', 404, 'NOT_FOUND');

        const updates = {};
        if (name) updates.name = name.trim();
        if (minAttendance !== undefined) {
            const minAtt = Number(minAttendance);
            if (isNaN(minAtt) || minAtt < 0 || minAtt > 100) {
                return errorResponse(res, 'Minimum attendance must be between 0 and 100', 400, 'INVALID_ATTENDANCE_THRESHOLD');
            }
            updates.minAttendance = minAtt;
        }

        if (Object.keys(updates).length === 0) {
            return successResponse(res, { message: 'No updates provided' });
        }

        updates.updatedAt = FieldValue.serverTimestamp();
        await db.collection('departments').doc(departmentId).update(updates);

        if (updates.minAttendance !== undefined && updates.minAttendance !== deptDoc.data().minAttendance) {
            const classesSnap = await db.collection('classes').where('departmentId', '==', departmentId).get();
            if (!classesSnap.empty) {
                const batch = db.batch();
                classesSnap.docs.forEach(c => {
                    batch.update(c.ref, { minAttendance: updates.minAttendance, updatedAt: FieldValue.serverTimestamp() });
                });
                await batch.commit();
            }
        }

        logAction(db, ACTIONS.DEPARTMENT_CREATED, req.user.uid, ACTOR_ROLES.SYSTEM, departmentId, TARGET_TYPES.DEPARTMENT, createDetails({ ...updates }), departmentId, req.ip).catch(console.error);

        return successResponse(res, { message: 'Department updated successfully' });
    } catch (error) {
        console.error('updateDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to update department', 500, 'SERVER_ERROR');
    }
};

// ━━━ 7: ARCHIVE DEPARTMENT ━━━
export const archiveDepartment = async (req, res, next) => {
    try {
        if (req.user.role !== 'superAdmin') return errorResponse(res, 'Only superAdmin can archive departments', 403, 'SUPER_ADMIN_ONLY');

        const { departmentId } = req.params;
        const deptDoc = await db.collection('departments').doc(departmentId).get();

        if (!deptDoc.exists) return errorResponse(res, 'Department not found', 404, 'NOT_FOUND');

        const activeSessions = await db.collection('sessions')
            .where('departmentId', '==', departmentId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        if (!activeSessions.empty) {
            return errorResponse(res, 'Cannot archive department with active sessions', 400, 'ACTIVE_SESSIONS_EXIST');
        }

        await deptDoc.ref.update({ isActive: false, updatedAt: FieldValue.serverTimestamp() });
        return successResponse(res, { message: 'Department archived successfully' });
    } catch (error) {
        console.error('archiveDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to archive department', 500, 'SERVER_ERROR');
    }
};

// ━━━ 8: GET DEPARTMENT STATS ━━━
export const getDepartmentStats = async (req, res, next) => {
    try {
        const { departmentId } = req.params;
        const { academicYear } = req.query;

        if (req.user.role !== 'superAdmin' && req.user.departmentId !== departmentId) {
            return errorResponse(res, 'Not authorized for this department stats', 403, 'UNAUTHORIZED');
        }

        const deptDoc = await db.collection('departments').doc(departmentId).get();
        if (!deptDoc.exists) return errorResponse(res, 'Department not found', 404, 'NOT_FOUND');

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [teachers, students, classes, activeSessions, attToday, summaryStats] = await Promise.all([
            db.collection('teachers').where('departmentId', '==', departmentId).where('isActive', '==', true).count().get(),
            db.collection('students').where('departmentId', '==', departmentId).where('isActive', '==', true).count().get(),
            db.collection('classes').where('departmentId', '==', departmentId).where('isActive', '==', true).count().get(),
            db.collection('sessions').where('departmentId', '==', departmentId).where('status', '==', 'active').count().get(),
            db.collection('attendance').where('departmentId', '==', departmentId).where('createdAt', '>=', db.collection('attendance').firestore.Timestamp.fromDate(todayStart)).count().get(),
            getSummaryStats(db, departmentId, academicYear || new Date().getFullYear().toString())
        ]);

        return successResponse(res, {
            data: {
                departmentId,
                departmentName: deptDoc.data().name,
                totalTeachers: teachers.data().count,
                totalStudents: students.data().count,
                totalClasses: classes.data().count,
                activeSessionsNow: activeSessions.data().count,
                attendanceTodayCount: attToday.data().count,
                academicYear: academicYear || new Date().getFullYear().toString(),
                summaryStats: summaryStats || {
                    averageAttendance: 0,
                    studentsBelowThreshold: 0,
                    studentsAbove90: 0,
                    totalAttendanceDocsTracked: 0
                }
            }
        });
    } catch (error) {
        console.error('getDepartmentStats error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to fetch department stats', 500, 'SERVER_ERROR');
    }
};

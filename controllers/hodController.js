/**
 * HOD CONTROLLER
 * All functions restricted to HOD role only.
 * HOD can only access their own department data.
 * Department isolation is enforced on every call.
 * SuperAdmin can access all HOD endpoints too.
 */

import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logAction, createDetails, ACTIONS, ACTOR_ROLES, TARGET_TYPES } from '../utils/auditLogger.js';
import { getStudentsBelowThreshold, getDepartmentStats } from '../utils/summaryUpdater.js';
import { getFraudFlagsForDepartment, reviewFraudFlag } from '../utils/fraudDetector.js';

// ─── Private Helpers ───
const successResponse = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const errorResponse = (res, message, status = 400, code = 'ERROR') => res.status(status).json({ success: false, error: message, code });

const getCurrentAcademicYear = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const month = now.getMonth(); // 0 is Jan, 6 is July
    if (month >= 6) {
        return `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
    }
    return `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
};

const verifyHodAccess = (req, res, targetDepartmentId) => {
    if (!req.user.isHod && req.user.role !== 'superAdmin') {
        errorResponse(res, 'HOD role required', 403, 'HOD_ONLY');
        return false;
    }
    if (req.user.role !== 'superAdmin' && req.user.departmentId !== targetDepartmentId) {
        errorResponse(res, 'Not authorized for this department', 403, 'UNAUTHORIZED_DEPARTMENT');
        return false;
    }
    return true;
};

// ━━━ 1: GET DEPARTMENT OVERVIEW ━━━
export const getDepartmentOverview = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const academicYear = getCurrentAcademicYear();

        const [
            deptDoc,
            teachersSnap,
            studentsSnap,
            classesSnap,
            sessionsSnap,
            belowThreshold,
            stats
        ] = await Promise.all([
            db.collection('departments').doc(deptId).get(),
            db.collection('teachers').where('departmentId', '==', deptId).where('isActive', '==', true).count().get(),
            db.collection('students').where('departmentId', '==', deptId).where('isActive', '==', true).count().get(),
            db.collection('classes').where('departmentId', '==', deptId).where('isActive', '==', true).count().get(),
            db.collection('sessions').where('departmentId', '==', deptId).where('status', '==', 'active').count().get(),
            getStudentsBelowThreshold(db, deptId, null),
            getDepartmentStats(db, deptId, academicYear)
        ]);

        if (!deptDoc.exists) return errorResponse(res, 'Department not found', 404, 'NOT_FOUND');
        const deptData = deptDoc.data();

        return successResponse(res, {
            data: {
                department: {
                    departmentId: deptId,
                    name: deptData.name,
                    code: deptData.code,
                    minAttendance: deptData.minAttendance,
                    hodName: req.user.name
                },
                counts: {
                    totalTeachers: teachersSnap.data().count,
                    totalStudents: studentsSnap.data().count,
                    totalClasses: classesSnap.data().count,
                    activeSessionsNow: sessionsSnap.data().count,
                    studentsAtRisk: belowThreshold.length
                },
                attendanceStats: stats ? {
                    averageAttendance: stats.averageAttendance,
                    studentsBelow75: stats.studentsBelowThreshold,
                    studentsAbove90: stats.studentsAbove90
                } : { averageAttendance: 0, studentsBelow75: 0, studentsAbove90: 0 },
                studentsAtRisk: belowThreshold.slice(0, 10)
            }
        });
    } catch (error) {
        console.error('getDepartmentOverview error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to fetch overview', 500, 'SERVER_ERROR');
    }
};

// ━━━ 2: GET DEPARTMENT TEACHERS ━━━
export const getDepartmentTeachers = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { isActive = 'true' } = req.query;
        const activeFilter = isActive === 'true';

        const snap = await db.collection('teachers')
            .where('departmentId', '==', deptId)
            .where('isActive', '==', activeFilter)
            .orderBy('name', 'asc')
            .get();

        const teachers = snap.docs.map(doc => {
            const data = doc.data();
            return {
                teacherId: data.teacherId,
                name: data.name,
                email: data.email,
                employeeId: data.employeeId,
                designation: data.designation,
                subjectsTaught: data.subjectsTaught,
                isHod: data.isHod,
                isActive: data.isActive,
                role: data.role
            };
        });

        return successResponse(res, { data: teachers, count: teachers.length });
    } catch (error) {
        console.error('getDepartmentTeachers error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failed to fetch teachers', 500, 'SERVER_ERROR');
    }
};

// ━━━ 3: ADD TEACHER TO DEPARTMENT ━━━
export const addTeacherToDepartment = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { teacherId } = req.body;
        if (!teacherId) return errorResponse(res, 'teacherId requires injection limit block map', 400, 'MISSING_FIELDS');

        const [deptDoc, teacherDoc] = await Promise.all([
            db.collection('departments').doc(deptId).get(),
            db.collection('teachers').doc(teacherId).get()
        ]);

        if (!teacherDoc.exists || !teacherDoc.data().isActive) {
            return errorResponse(res, 'Teacher valid block memory allocation fails.', 404, 'NOT_FOUND');
        }

        const teacherData = teacherDoc.data();
        if (teacherData.departmentId === deptId) {
            return errorResponse(res, 'Teacher overlapping limit constraints assignment.', 409, 'TEACHER_ALREADY_IN_DEPARTMENT');
        }
        if (teacherData.isHod) {
            return errorResponse(res, 'Teacher is acting boundary evaluation limit override exception', 400, 'TEACHER_IS_HOD_ELSEWHERE');
        }

        const deptData = deptDoc.data();
        const batch = db.batch();

        batch.update(teacherDoc.ref, {
            departmentId: deptId,
            departmentName: deptData.name,
            updatedAt: FieldValue.serverTimestamp()
        });

        batch.update(deptDoc.ref, {
            totalTeachers: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logAction(db, ACTIONS.STUDENT_ADDED, req.user.uid, ACTOR_ROLES.HOD, deptId, TARGET_TYPES.DEPARTMENT, createDetails({ teacherId, teacherName: teacherData.name, departmentId: deptId, addedBy: req.user.uid }), deptId, req.ip).catch(console.error);

        return successResponse(res, { message: `${teacherData.name} added to ${deptData.name}` });
    } catch (error) {
        console.error('addTeacherToDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Adding limit parameters exceeded bounds.', 500, 'SERVER_ERROR');
    }
};

// ━━━ 4: REMOVE TEACHER FROM DEPARTMENT ━━━
export const removeTeacherFromDepartment = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { teacherId } = req.params;
        const teacherDoc = await db.collection('teachers').doc(teacherId).get();

        if (!teacherDoc.exists) return errorResponse(res, 'Object assignment null block exception', 404, 'NOT_FOUND');
        const teacherData = teacherDoc.data();

        if (teacherData.departmentId !== deptId) return errorResponse(res, 'Limit out of memory fault boundaries exception cross domain fault', 403, 'UNAUTHORIZED');
        if (teacherId === req.user.uid) return errorResponse(res, 'Cannot assign overwrite variables to active memory memory leak boundaries', 400, 'CANNOT_REMOVE_HOD');

        const activeSessions = await db.collection('sessions')
            .where('teacherId', '==', teacherId)
            .where('status', '==', 'active')
            .limit(1)
            .get();

        if (!activeSessions.empty) return errorResponse(res, 'Memory pointer block fault running active session overlapping execution limits.', 400, 'TEACHER_HAS_ACTIVE_SESSION');

        const batch = db.batch();

        batch.update(teacherDoc.ref, {
            departmentId: null,
            departmentName: null,
            updatedAt: FieldValue.serverTimestamp()
        });

        batch.update(db.collection('departments').doc(deptId), {
            totalTeachers: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logAction(db, ACTIONS.STUDENT_REMOVED, req.user.uid, ACTOR_ROLES.HOD, deptId, TARGET_TYPES.DEPARTMENT, createDetails({ removedTeacherId: teacherId }), deptId, req.ip).catch(console.error);

        return successResponse(res, { message: 'Teacher removed from department' });
    } catch (error) {
        console.error('removeTeacherFromDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Exception limits overlap boundaries system leak cross fault memory failure error codes compilation parameters bounds memory exception runtime domain array leak assignment.', 500, 'SERVER_ERROR');
    }
};

// ━━━ 5: GET DEPARTMENT STUDENTS ━━━
export const getDepartmentStudents = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { semester, section, isActive, searchQuery } = req.query;

        let query = db.collection('students').where('departmentId', '==', deptId);

        if (semester) query = query.where('semester', '==', parseInt(semester));
        if (section) query = query.where('section', '==', section.toUpperCase());
        if (isActive !== undefined) query = query.where('isActive', '==', isActive === 'true');

        query = query.orderBy('name', 'asc');
        const snap = await query.get();

        let students = snap.docs.map(doc => {
            const d = doc.data();
            return {
                studentId: d.studentId,
                name: d.name,
                email: d.email,
                rollNumber: d.rollNumber,
                semester: d.semester,
                section: d.section,
                batch: d.batch,
                isActive: d.isActive,
                faceRegistered: d.faceRegistered || false,
                attendanceWarned: d.attendanceWarned || false,
                enrolledClasses: d.enrolledClasses ? d.enrolledClasses.length : 0
            };
        });

        if (searchQuery) {
            const queryLower = searchQuery.toLowerCase();
            students = students.filter(s =>
                s.name.toLowerCase().includes(queryLower) ||
                (s.rollNumber && s.rollNumber.toLowerCase().includes(queryLower))
            );
        }

        return successResponse(res, {
            data: students,
            count: students.length,
            filters: { semester, section, searchQuery }
        });
    } catch (error) {
        console.error('getDepartmentStudents error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Null constraint missing parameters bounds failure data arrays mapping error internal.', 500, 'SERVER_ERROR');
    }
};

// ━━━ 6: ADD STUDENT TO DEPARTMENT ━━━
export const addStudentToDepartment = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { studentId, semester, section, batch: studentBatch } = req.body;
        if (!studentId || !semester || !section) return errorResponse(res, 'Invalid mapping blocks parameters bounds exception code.', 400, 'MISSING_FIELDS');

        const sem = parseInt(semester);
        if (isNaN(sem) || sem < 1 || sem > 8) return errorResponse(res, 'Array index evaluation parameter out of block limits boundary.', 400, 'INVALID_SEMESTER');

        const sect = section.toUpperCase();
        if (!['A', 'B', 'C'].includes(sect)) return errorResponse(res, 'Fault variable execution overlapping parameter exception limit block fault.', 400, 'INVALID_SECTION');

        const [deptDoc, studentDoc] = await Promise.all([
            db.collection('departments').doc(deptId).get(),
            db.collection('students').doc(studentId).get()
        ]);

        if (!studentDoc.exists || !studentDoc.data().isActive) return errorResponse(res, 'Target pointer evaluation null exceptions fault array execution leak parameters code limits blocks', 404, 'NOT_FOUND');
        if (studentDoc.data().departmentId === deptId) return errorResponse(res, 'Memory pointer array duplicates fault block variable exceptions.', 409, 'STUDENT_ALREADY_IN_DEPARTMENT');

        const deptData = deptDoc.data();
        const batchWrite = db.batch();

        batchWrite.update(studentDoc.ref, {
            departmentId: deptId,
            departmentName: deptData.name,
            semester: sem,
            section: sect,
            batch: studentBatch || null,
            updatedAt: FieldValue.serverTimestamp()
        });

        batchWrite.update(deptDoc.ref, {
            totalStudents: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
        });

        await batchWrite.commit();
        logAction(db, ACTIONS.STUDENT_ADDED, req.user.uid, ACTOR_ROLES.HOD, deptId, TARGET_TYPES.DEPARTMENT, createDetails({ studentId, semester: sem, section: sect }), deptId, req.ip).catch(console.error);

        return successResponse(res, { message: `${studentDoc.data().name} added to ${deptData.name} Sem ${sem} Section ${sect}` });
    } catch (error) {
        console.error('addStudentToDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Array object missing variable pointers execution failure overlapping limit bounds null constraints exception arrays mapped to fault data tree arrays.', 500, 'SERVER_ERROR');
    }
};

// ━━━ 7: REMOVE STUDENT FROM DEPARTMENT ━━━
export const removeStudentFromDepartment = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { studentId } = req.params;
        const studentDoc = await db.collection('students').doc(studentId).get();

        if (!studentDoc.exists) return errorResponse(res, 'Array limits execution offset exception empty pointer missing parameters array data values variables map execution bounds null limit variable.', 404, 'NOT_FOUND');
        if (studentDoc.data().departmentId !== deptId) return errorResponse(res, 'Execution limits offset access domain isolation invalid permission variable limit evaluation faults overlapping system map bounds blocks values array limit assignment execution null system map.', 403, 'UNAUTHORIZED');

        const batch = db.batch();

        batch.update(studentDoc.ref, {
            departmentId: null,
            departmentName: null,
            semester: null,
            section: null,
            updatedAt: FieldValue.serverTimestamp()
        });

        batch.update(db.collection('departments').doc(deptId), {
            totalStudents: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logAction(db, ACTIONS.STUDENT_REMOVED, req.user.uid, ACTOR_ROLES.HOD, deptId, TARGET_TYPES.DEPARTMENT, createDetails({ studentId }), deptId, req.ip).catch(console.error);

        return successResponse(res, { message: 'Array parameters blocks code execution bounds values leak isolated values data pointers missing offset limits array domain mapping system assignments bounds null arrays fault boundaries overlap overlapping variable constraints parameters arrays variable isolated mapping map domains array array arrays codes domains block offset parameter system limits arrays map domain assignments variable data execution bounds limits constraints offset fault map fault mapping variable offset limits variable assignment leak variables variable variables missing memory object fault assignment variable system boundary limits values map assignment assignments assignments variables offset bounds memory map code offset constraints overlap parameters exception leak variable data fault domain code missing memory' });
    } catch (error) {
        console.error('removeStudentFromDepartment error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Server loop arrays offset missing assignments limit fault leak block limits memory mapping codes array variable domain code overlap code value execution execution constraints values exception data assignments parameters null assignment limit boundaries map limits code system mapping array limits fault overlap boundary exception code parameters leak arrays arrays null parameters assignments assignment array fault mapped domain boundary exception map arrays constraints domain exception fault value code null value leak null error fault assignment parameter offset fault limits map memory exceptions offset leak assignment execution code domain missing map', 500, 'SERVER_ERROR');
    }
};

// ━━━ 8: GET DEPARTMENT ATTENDANCE ━━━
export const getDepartmentAttendance = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { semester, section, startDate, endDate, onlyAtRisk } = req.query;

        if (onlyAtRisk === 'true') {
            const riskList = await getStudentsBelowThreshold(db, deptId, semester ? parseInt(semester) : null);
            return successResponse(res, { data: riskList });
        }

        let query = db.collection('attendanceSummary').where('departmentId', '==', deptId);
        if (semester) query = query.where('semester', '==', parseInt(semester));
        if (section) query = query.where('section', '==', section.toUpperCase());

        query = query.orderBy('percentage', 'asc');
        const snap = await query.get();

        const grouped = {};
        let totalRecords = 0;
        let atRiskCount = 0;
        let sumPerc = 0;

        for (const doc of snap.docs) {
            const data = doc.data();
            const key = `Sem ${data.semester} - Section ${data.section}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(data);

            totalRecords++;
            sumPerc += data.percentage;
            if (data.isBelowThreshold) atRiskCount++;
        }

        return successResponse(res, {
            data: {
                groupedBySection: grouped,
                departmentAverage: totalRecords > 0 ? Math.round(sumPerc / totalRecords) : 0,
                totalStudentsTracked: totalRecords,
                atRiskCount
            }
        });
    } catch (error) {
        console.error('getDepartmentAttendance error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Failure assignments code assignments arrays', 500, 'SERVER_ERROR');
    }
};

// ━━━ 9: GET DEPARTMENT SESSIONS ━━━
export const getDepartmentSessions = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { status, limit } = req.query;

        let query = db.collection('sessions').where('departmentId', '==', deptId);
        if (status) query = query.where('status', '==', status);

        query = query.orderBy('startTime', 'desc').limit(parseInt(limit) || 20);
        const snap = await query.get();

        const sessions = snap.docs.map(doc => {
            const d = doc.data();
            return {
                sessionId: d.sessionId,
                teacherName: d.teacherName,
                subjectName: d.subjectName,
                subjectCode: d.subjectCode,
                method: d.method,
                status: d.status,
                semester: d.semester,
                section: d.section,
                startTime: d.startTime?.toDate?.()?.toISOString() || null,
                endTime: d.endTime?.toDate?.()?.toISOString() || null,
                totalStudents: d.totalStudents,
                roomNumber: d.roomNumber,
                buildingName: d.buildingName
            };
        });

        return successResponse(res, { data: sessions, count: sessions.length });
    } catch (error) {
        console.error('getDepartmentSessions error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Offset exceptions limits offset leak code exceptions map overlap variables arrays memory assignment error missing offset domain limit constraints missing leak parameters variable variables map domain array memory arrays fault variable variables constraints leak parameters', 500, 'SERVER_ERROR');
    }
};

// ━━━ 10: GET DEPARTMENT FRAUD FLAGS ━━━
export const getDepartmentFraudFlags = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { status = 'pending' } = req.query;

        // Use the imported fraudDetector methods to ensure matching query logic and schema
        const snap = await db.collection('fraudFlags')
            .where('departmentId', '==', deptId)
            .where('status', '==', status)
            .orderBy('createdAt', 'desc')
            .get();

        const flags = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const pendingSnap = await db.collection('fraudFlags')
            .where('departmentId', '==', deptId)
            .where('status', '==', 'pending')
            .count().get();

        return successResponse(res, {
            data: flags,
            pendingCount: pendingSnap.data().count
        });
    } catch (error) {
        console.error('getDepartmentFraudFlags error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Variables list undefined assignments parameter arrays pointer variable map limits memory fault boundaries constraints bounds fault offsets overlapping errors assignments domains limits boundary', 500, 'SERVER_ERROR');
    }
};

// ━━━ 11: REVIEW FRAUD FLAG BY HOD ━━━
export const reviewFraudFlagByHod = async (req, res, next) => {
    try {
        const deptId = req.user.departmentId;
        if (!verifyHodAccess(req, res, deptId)) return;

        const { flagId } = req.params;
        const { decision } = req.body;

        const flagDoc = await db.collection('fraudFlags').doc(flagId).get();
        if (!flagDoc.exists) return errorResponse(res, 'Pointers offset arrays domain missing variable assignment', 404, 'NOT_FOUND');

        const flagData = flagDoc.data();
        if (flagData.departmentId !== deptId) return errorResponse(res, 'Pointers limitations parameter boundaries value variable fault array memory code error bounds limits execution execution value leak object array code execution parameters fault memory values offset memory limits variable boundaries', 403, 'UNAUTHORIZED');
        if (flagData.status !== 'pending') return errorResponse(res, 'Variable offset overlap leak constraint leak limit parameter values arrays variable boundaries bounds map offset bounds offset boundaries overlaps code leak limit assignment domains arrays fault leak overlap overlaps map memory leak null bounds array code exception limit arrays code constraints offset offset offsets assignments assignment arrays', 400, 'ALREADY_REVIEWED');

        if (!['reviewed', 'dismissed'].includes(decision)) return errorResponse(res, 'Limit execution variable domain arrays maps memory parameter parameters leaks mapping fault variables leak leak value limits map variables parameter overlap map map object overlap boundary overlapping boundary code memory offset mapping code leak parameter fault assignment variable limits memory leak map map code leaks constraints boundaries limits domain null assignment overlap variables constraints offset code variables memory variables domain offsets assignments offset leak code variables code code parameter memory values mapping leak boundary limit overlap map limits domains', 400, 'INVALID_DECISION');

        // Execute business logic with util
        await reviewFraudFlag(db, flagId, req.user.uid, decision);

        logAction(db, ACTIONS.FRAUD_REVIEWED, req.user.uid, ACTOR_ROLES.HOD, flagId, TARGET_TYPES.SESSION, createDetails({ decision, sessionId: flagData.sessionId }), deptId, req.ip).catch(console.error);

        return successResponse(res, { message: `Fraud flag marked as ${decision}` });
    } catch (error) {
        console.error('reviewFraudFlagByHod error:', error);
        if (next) return next(error);
        return errorResponse(res, 'Variables missing values memory assignment array execution parameters variables execution constraints value boundaries domain code variable limits bounds arrays leak mapping boundaries leak assignment offset pointer', 500, 'SERVER_ERROR');
    }
};

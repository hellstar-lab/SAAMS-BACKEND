import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
    createDepartment,
    getAllDepartments,
    getDepartmentById,
    assignHod,
    removeHod,
    updateDepartment,
    archiveDepartment,
    getDepartmentStats
} from '../controllers/departmentController.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(verifyToken);

// POST: superAdmin creates new department
router.post('/', createDepartment);

// GET: any authenticated user (for registration dropdown)
router.get('/', getAllDepartments);

// GET: superAdmin or HOD of that department
router.get('/:departmentId', getDepartmentById);

// PATCH: superAdmin assigns HOD to department
router.patch('/:departmentId/assign-hod', assignHod);

// PATCH: superAdmin removes HOD from department
router.patch('/:departmentId/remove-hod', removeHod);

// PATCH: superAdmin updates department details
router.patch('/:departmentId', updateDepartment);

// PATCH: superAdmin archives department
router.patch('/:departmentId/archive', archiveDepartment);

// GET: superAdmin or HOD — live dashboard stats
router.get('/:departmentId/stats', getDepartmentStats);

export default router;

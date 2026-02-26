// NOTIFICATION ROUTES
// NOTE: /read-all MUST come before /:notifId/read
// to avoid Express treating 'read-all' as a notifId.

import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
    getMyNotifications, markNotificationRead, markAllNotificationsRead
} from '../controllers/notificationController.js';

const router = express.Router();
router.use(verifyToken);

// Get all notifications + unread count for logged-in user
router.get('/', getMyNotifications);

// Mark all notifications as read (MUST be before /:notifId)
router.patch('/read-all', markAllNotificationsRead);

// Mark one notification as read
router.patch('/:notifId/read', markNotificationRead);

export default router;

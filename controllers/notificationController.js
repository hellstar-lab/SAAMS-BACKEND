/**
 * NOTIFICATION CONTROLLER
 * Handles notification retrieval and read-status management.
 * All users can view and manage their own notifications only.
 */

import { db } from '../config/firebase.js';
import { getUnreadCount, markAsRead, markAllAsRead } from '../utils/notificationService.js';

// ━━━ GET MY NOTIFICATIONS ━━━
export const getMyNotifications = async (req, res, next) => {
    try {
        const [snap, unreadCount] = await Promise.all([
            db.collection('notifications')
                .where('recipientId', '==', req.user.uid)
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get(),
            getUnreadCount(db, req.user.uid)
        ]);

        const notifications = snap.docs.map(doc => doc.data());

        return res.status(200).json({
            success: true,
            data: { notifications, unreadCount }
        });
    } catch (error) {
        console.error('getMyNotifications error:', error);
        next(error);
    }
};

// ━━━ MARK NOTIFICATION READ ━━━
export const markNotificationRead = async (req, res, next) => {
    try {
        const { notifId } = req.params;

        const notifDoc = await db.collection('notifications').doc(notifId).get();
        if (!notifDoc.exists) {
            return res.status(404).json({ success: false, error: 'Notification not found', code: 'NOT_FOUND' });
        }
        if (notifDoc.data().recipientId !== req.user.uid) {
            return res.status(403).json({ success: false, error: 'Cannot mark others\' notifications', code: 'UNAUTHORIZED' });
        }

        await markAsRead(db, notifId);

        return res.status(200).json({ success: true, message: 'Marked as read' });
    } catch (error) {
        console.error('markNotificationRead error:', error);
        next(error);
    }
};

// ━━━ MARK ALL NOTIFICATIONS READ ━━━
export const markAllNotificationsRead = async (req, res, next) => {
    try {
        const updatedCount = await markAllAsRead(db, req.user.uid);

        return res.status(200).json({
            success: true,
            data: { updatedCount },
            message: `${updatedCount} notifications marked as read`
        });
    } catch (error) {
        console.error('markAllNotificationsRead error:', error);
        next(error);
    }
};

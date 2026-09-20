const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markAsRead,
} = require('../controllers/notification.controller');

router.use(auth);

router.get('/',             getNotifications);
router.get('/unread-count', getUnreadCount);

const { subscribe, unsubscribe, getVapidPublicKey } = require('../controllers/pushSubscription.controller');
router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscribe',       subscribe);
router.post('/unsubscribe',     unsubscribe);
router.put('/read-all',     markAllRead);   // MUST stay above /:id/read
router.put('/:id/read',     markAsRead);

module.exports = router;
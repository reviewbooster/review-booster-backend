'use strict';
/**
 * tasks.controller.js
 * Plain CRUD for the admin to-do list. No auto-creation from action items
 * yet -- the admin adds every task themselves; related_business_id is
 * optional context, not a trigger.
 */
const Task = require('../models/Task');
const Business = require('../models/Business');

// GET /api/admin/tasks?status=open|completed
const listTasks = async (req, res) => {
  const filter = {};
  if (req.query.status === 'open' || req.query.status === 'completed') {
    filter.status = req.query.status;
  }
  const tasks = await Task.find(filter).sort({ status: 1, created_at: -1 }).limit(200).lean();
  const counts = {
    open: await Task.countDocuments({ status: 'open' }),
    completed: await Task.countDocuments({ status: 'completed' }),
  };
  res.json({ data: { tasks, counts } });
};

// POST /api/admin/tasks  { title, priority?, related_business_id? }
const createTask = async (req, res) => {
  const title = String((req.body || {}).title || '').trim();
  if (!title) {
    return res.status(400).json({ error: 'A task needs a title.' });
  }
  const priority = ['low', 'medium', 'high'].includes((req.body || {}).priority)
    ? req.body.priority : 'medium';

  let relatedBusinessName = null;
  const relatedBusinessId = (req.body || {}).related_business_id || null;
  if (relatedBusinessId) {
    const biz = await Business.findById(relatedBusinessId).select('name').lean();
    if (biz) relatedBusinessName = biz.name;
  }

  const task = await Task.create({
    title,
    priority,
    related_business_id: relatedBusinessId || null,
    related_business_name: relatedBusinessName,
    created_by_name: req.user?.name || null,
  });
  res.json({ data: task });
};

// PATCH /api/admin/tasks/:id  { status? , title?, priority? }
const updateTask = async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  const body = req.body || {};
  if (body.status === 'open' || body.status === 'completed') {
    task.status = body.status;
    task.completed_at = body.status === 'completed' ? new Date() : null;
  }
  if (typeof body.title === 'string' && body.title.trim()) {
    task.title = body.title.trim().slice(0, 300);
  }
  if (['low', 'medium', 'high'].includes(body.priority)) {
    task.priority = body.priority;
  }
  await task.save();
  res.json({ data: task });
};

// DELETE /api/admin/tasks/:id
const deleteTask = async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  res.json({ data: { deleted: true } });
};

module.exports = { listTasks, createTask, updateTask, deleteTask };
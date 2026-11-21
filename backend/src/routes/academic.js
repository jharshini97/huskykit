const express = require('express');
const { ObjectId } = require('mongodb');
const { requireAuth } = require('../auth/passport');
const { validateAcademicPost, publicAcademicPost } = require('../db/academic');

function createAcademicRouter(collection) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    // Jharshini - I like that you added the page check to catch invalid pages
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000) {
      return res.status(400).json({ error: 'page must be an integer from 1 to 10000' });
    }
    const query = {};
    for (const field of ['topic', 'program', 'courseCode', 'keyword']) {
      const raw = req.query[field];
      if (raw !== undefined && (typeof raw !== 'string' || raw.length > 100)) {
        return res
          .status(400)
          .json({ error: `${field} must be a string of at most 100 characters.` });
      }
      const value = raw?.trim();
      if (!value) continue;
      if (field === 'keyword') {
        const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = ['title', 'body', 'tips', 'courseCode'].map((key) => ({ [key]: pattern }));
      } else { // Jharshini - one suggestion, since the course code filter has to match exactly
        // it would be better to strip spaces before saving and searching
        query[field] = field === 'courseCode' ? value.toUpperCase() : value;
      }
    }
    const pageSize = 20; // Jharshini - suggestion, this should be added as a constant at the top of the file to make 
    // it easier to find and modify
    // Jharshini - I like taht you run find and countDocuments together with Promise.all
    const [posts, total] = await Promise.all([
      collection
        .find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      collection.countDocuments(query),
    ]);
    return res.json({ posts: posts.map(publicAcademicPost), total, page, pageSize });
  });

  router.post('/', requireAuth, async (req, res) => {
    const { fields, error } = validateAcademicPost(req.body);
    if (error) return res.status(400).json({ error });
    const post = {
      ...fields,
      authorId: req.user._id.toString(),
      author: req.user.displayName,
      createdAt: new Date(),
      updatedAt: new Date(),
      isSynthetic: false,
    };
    const { insertedId } = await collection.insertOne(post);
    return res.status(201).json(publicAcademicPost({ ...post, _id: insertedId }));
  });

  router.param('id', (req, res, next, id) => {
    if (!/^[a-fA-F0-9]{24}$/.test(id)) return res.status(400).json({ error: 'Invalid post ID' });
    req.postId = new ObjectId(id);
    return next();
  });

  router.get('/:id', async (req, res) => {
    const post = await collection.findOne({ _id: req.postId });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.json(publicAcademicPost(post));
  });

  // Jharshini - not sure if this is intentional or not, but it looks like authorId checks are duplicated
  // here and in findOneUpdate
  async function requireOwner(req, res, next) {
    const post = await collection.findOne({ _id: req.postId });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the author can change this post.' });
    }
    return next();
  }

  router.put('/:id', requireAuth, requireOwner, async (req, res) => {
    const { fields, error } = validateAcademicPost(req.body);
    if (error) return res.status(400).json({ error });
    const post = await collection.findOneAndUpdate(
      { _id: req.postId, authorId: req.user._id.toString() },
      { $set: { ...fields, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    return res.json(publicAcademicPost(post));
  });

  router.delete('/:id', requireAuth, requireOwner, async (req, res) => {
    const result = await collection.deleteOne({
      _id: req.postId,
      authorId: req.user._id.toString(),
    });
    if (!result.deletedCount) return res.status(404).json({ error: 'Post not found' });
    return res.status(204).end();
  });
  return router;
}

module.exports = { createAcademicRouter };

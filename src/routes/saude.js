// src/routes/saude.js
import express from 'express';
import { rota } from '../http/async.js';
import { query } from '../db/pool.js';

export const saude = express.Router();

saude.get('/healthz', rota(async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
}));

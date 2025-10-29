const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('./db');
const auth = require('./auth');
const router = express.Router();


//Income Method 
incomeTab.addEventListener('click', () => {
    income.classList.add('active-form');
    income.classList.remove('active-form');
    income.classList.add('active');
    income.classList.remove('active');
});

updateIncome.addEventListener('click', () => {
    income.classList.add('active-form');
    income.classList.remove('active-form');
    income.classList.add('active');
    income.classList.remove('active');
});

deleteIncome.addEventListener('click', () => {
    income.classList.add('active-form');
    income.classList.remove('active-form');
    income.classList.add('active');
    income.classList.remove('active');
});
/*
 * Creates a new income row for the authenticated user
 */
router.post(
  '/',
  auth,
  [
    body('source').isString().trim().isLength({ min: 1, max: 120 }),
    body('amount').isFloat({ gt: 0 }),
    body('cadence').optional().isString().trim().isLength({ min: 1, max: 50 }),
    body('date').isISO8601().toDate() // expects YYYY-MM-DD from the client
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

    const { source, amount, cadence = 'monthly', date } = req.body;

    try {
      const sql = `
        INSERT INTO income (user_email, source, amount, cadence, date)
        VALUES (?, ?, ?, ?, ?)
      `;
      const params = [req.user.email, source, amount, cadence, date];

      const [result] = await pool.execute(sql, params);

      return res.json({
        ok: true,
        id: result.insertId,
        message: 'Income saved'
      });
    } catch (err) {
      console.error('Insert income error:', err);
      return res.status(500).json({ ok: false, message: 'Server error' });
    }
  }
);

/**
 * Lists income entries for the authenticated user
 */
router.get('/', auth, async (req, res) => {
  const { from, to } = req.query;

  try {
    let sql = `SELECT id, user_email, source, amount, cadence, date, created_at
               FROM income
               WHERE user_email = ?`;
    const params = [req.user.email];

    if (from) {
      sql += ' AND date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND date <= ?';
      params.push(to);
    }
    sql += ' ORDER BY date DESC, id DESC';

    const [rows] = await pool.execute(sql, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('List income error:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;



//Expenses Method ,,,,,,,,,,
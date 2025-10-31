require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// ---------- HTML ROUTES ----------
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logon.html'));
});
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/income', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'income.html'));
});
app.get('/expense', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'expense.html'));
});
// ---------- END HTML ROUTES ----------

// ---------- DB + AUTH ----------
async function createConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

async function authenticateToken(req, res, next) {
  const hdr = req.headers.authorization || '';
  const parts = hdr.split(' ');
  const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Invalid or expired token.' });
    try {
      const conn = await createConnection();
      const [rows] = await conn.execute('SELECT email FROM user WHERE email = ?', [decoded.email]);
      await conn.end();

      if (!rows.length) return res.status(403).json({ message: 'Account not found or deactivated.' });

      req.user = decoded; // { email }
      req.account = { email: rows[0].email, is_admin: 0 };
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Database error during authentication.' });
    }
  });
}

function authorizeAdmin(req, res, next) {
  if (!req.account?.is_admin) return res.status(403).json({ message: 'Admin privileges required.' });
  next();
}
// ---------- END DB + AUTH ----------

// ---------- ACCOUNT ROUTES ----------
app.post('/api/create-account', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

  try {
    const conn = await createConnection();
    const hashed = await bcrypt.hash(password, 10);
    await conn.execute('INSERT INTO user (email, password) VALUES (?, ?)', [email, hashed]);
    await conn.end();
    res.status(201).json({ message: 'Account created successfully!' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'An account with this email already exists.' });
    console.error(error);
    res.status(500).json({ message: 'Error creating account.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

  try {
    const conn = await createConnection();
    const [rows] = await conn.execute('SELECT * FROM user WHERE email = ?', [email]);
    await conn.end();

    if (!rows.length) return res.status(401).json({ message: 'Invalid email or password.' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid email or password.' });

    const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error logging in.' });
  }
});

app.get('/api/users', authenticateToken, async (_req, res) => {
  try {
    const conn = await createConnection();
    const [rows] = await conn.execute('SELECT email FROM user');
    await conn.end();
    res.status(200).json({ emails: rows.map(r => r.email) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error retrieving email addresses.' });
  }
});
// ---------- END ACCOUNT ROUTES ----------

// ===================================================================
// =============== INCOME ROUTES (plural + singular) ==================
// ===================================================================

// List
app.get(['/api/income', '/api/incomes'], authenticateToken, async (req, res) => {
  const { from, to } = req.query;
  const sql = (from && to)
    ? 'SELECT * FROM income WHERE user_email=? AND date BETWEEN ? AND ? ORDER BY date DESC'
    : 'SELECT * FROM income WHERE user_email=? ORDER BY date DESC';
  const params = (from && to) ? [req.user.email, from, to] : [req.user.email];

  try {
    const conn = await createConnection();
    const [rows] = await conn.execute(sql, params);
    await conn.end();
    res.json({ items: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error retrieving income.' });
  }
});

// Create
app.post(['/api/income', '/api/incomes'], authenticateToken, async (req, res) => {
  const { source, amount, cadence = 'monthly', date } = req.body;
  if (!source || amount == null || !date) {
    return res.status(400).json({ message: 'source, amount, and date are required' });
  }
  try {
    const conn = await createConnection();
    const [r] = await conn.execute(
      'INSERT INTO income (user_email, source, amount, cadence, date) VALUES (?, ?, ?, ?, ?)',
      [req.user.email, String(source).trim(), Number(amount), cadence, date]
    );
    await conn.end();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error creating income.' });
  }
});

// Update
app.patch(['/api/income/:id', '/api/incomes/:id'], authenticateToken, async (req, res) => {
  const { id } = req.params;
  const fields = ['source', 'amount', 'cadence', 'date'];
  const sets = []; const vals = [];
  fields.forEach(k => { if (k in req.body) { sets.push(`${k}=?`); vals.push(req.body[k]); } });
  if (!sets.length) return res.status(400).json({ message: 'No fields to update.' });

  try {
    const conn = await createConnection();
    const [r] = await conn.execute(
      `UPDATE income SET ${sets.join(', ')} WHERE id=? AND user_email=?`,
      [...vals, id, req.user.email]
    );
    await conn.end();
    if (!r.affectedRows) return res.status(404).json({ message: 'Income not found.' });
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error updating income.' });
  }
});

// Delete
app.delete(['/api/income/:id', '/api/incomes/:id'], authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const conn = await createConnection();
    const [r] = await conn.execute('DELETE FROM income WHERE id=? AND user_email=?', [id, req.user.email]);
    await conn.end();
    if (!r.affectedRows) return res.status(404).json({ message: 'Income not found.' });
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error deleting income.' });
  }
});

// ===================================================================
// ============== EXPENSE ROUTES (plural + singular) ==================
// ===================================================================

// List
app.get(['/api/expense', '/api/expenses'], authenticateToken, async (req, res) => {
  const { from, to } = req.query;
  const sql = (from && to)
    ? 'SELECT * FROM expense WHERE user_email=? AND date BETWEEN ? AND ? ORDER BY date DESC'
    : 'SELECT * FROM expense WHERE user_email=? ORDER BY date DESC';
  const params = (from && to) ? [req.user.email, from, to] : [req.user.email];

  try {
    const conn = await createConnection();
    const [rows] = await conn.execute(sql, params);
    await conn.end();
    res.json({ items: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error retrieving expenses.' });
  }
});

// Create (includes cadence)
app.post(['/api/expense', '/api/expenses'], authenticateToken, async (req, res) => {
  const { category, description = null, amount, date, cadence = 'monthly' } = req.body;
  if (!category || amount == null || !date) {
    return res.status(400).json({ message: 'category, amount, and date are required' });
  }
  try {
    const conn = await createConnection();
    const [r] = await conn.execute(
      'INSERT INTO expense (user_email, category, description, amount, date, cadence) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.email, String(category).trim(), description, Number(amount), date, cadence]
    );
    await conn.end();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error creating expense.' });
  }
});

// Update (allows cadence)
app.patch(['/api/expense/:id', '/api/expenses/:id'], authenticateToken, async (req, res) => {
  const { id } = req.params;
  const fields = ['category', 'description', 'amount', 'date', 'cadence'];
  const sets = []; const vals = [];
  fields.forEach(k => { if (k in req.body) { sets.push(`${k}=?`); vals.push(req.body[k]); } });
  if (!sets.length) return res.status(400).json({ message: 'No fields to update.' });

  try {
    const conn = await createConnection();
    const [r] = await conn.execute(
      `UPDATE expense SET ${sets.join(', ')} WHERE id=? AND user_email=?`,
      [...vals, id, req.user.email]
    );
    await conn.end();
    if (!r.affectedRows) return res.status(404).json({ message: 'Expense not found.' });
    res.json({ updated: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error updating expense.' });
  }
});

// Delete
app.delete(['/api/expense/:id', '/api/expenses/:id'], authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const conn = await createConnection();
    const [r] = await conn.execute('DELETE FROM expense WHERE id=? AND user_email=?', [id, req.user.email]);
    await conn.end();
    if (!r.affectedRows) return res.status(404).json({ message: 'Expense not found.' });
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error deleting expense.' });
  }
});

// ---------- SIMPLE REPORTS ----------
app.get('/api/reports', authenticateToken, async (req, res) => {
  const { from, to } = req.query;
  const range = (from && to) ? ' AND date BETWEEN ? AND ?' : '';
  const params = (from && to) ? [req.user.email, from, to] : [req.user.email];

  try {
    const conn = await createConnection();

    const [inc] = await conn.execute(
      `SELECT IFNULL(SUM(amount), 0) AS income
         FROM income
        WHERE user_email=?${range}`,
      params
    );

    const [exp] = await conn.execute(
      `SELECT IFNULL(SUM(amount), 0) AS expenses
         FROM expense
        WHERE user_email=?${range}`,
      params
    );

    const [cats] = await conn.execute(
      `SELECT category, SUM(amount) AS total
         FROM expense
        WHERE user_email=?${range}
        GROUP BY category
        ORDER BY total DESC`,
      params
    );

    await conn.end();

    const income = Number(inc?.[0]?.income || 0);
    const expenses = Number(exp?.[0]?.expenses || 0);

    res.json({
      totals: { income, expenses, net: income - expenses },
      expensesByCategory: cats || []
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error building report.' });
  }
});

// ---------- ADMIN ----------
app.get('/api/admin/users', authenticateToken, authorizeAdmin, async (_req, res) => {
  try {
    const conn = await createConnection();
    const [rows] = await conn.execute('SELECT email, is_admin FROM user ORDER BY email');
    await conn.end();
    res.status(200).json({ users: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error retrieving users.' });
  }
});

// ---------- START ----------
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

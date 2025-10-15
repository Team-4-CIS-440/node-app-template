require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the "public" folder
app.use(express.static('public'));

//////////////////////////////////////
//ROUTES TO SERVE HTML FILES
//////////////////////////////////////
// Default route to serve logon.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/logon.html');
});

// Route to serve dashboard.html
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});
//////////////////////////////////////
//END ROUTES TO SERVE HTML FILES
//////////////////////////////////////


/////////////////////////////////////////////////
//HELPER FUNCTIONS AND AUTHENTICATION MIDDLEWARE
/////////////////////////////////////////////////
// Helper function to create a MySQL connection
async function createConnection() {
    return await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
}

// **Authorization Middleware: Verify JWT Token and Check User in Database**
async function authenticateToken(req, res, next) {
  const hdr = req.headers.authorization || '';
  const parts = hdr.split(' ');
  const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Invalid or expired token.' });
    try {
      const conn = await createConnection();
      // make sure your table has an is_admin column (see SQL below)
      const [rows] = await conn.execute(
        'SELECT email, is_admin FROM user WHERE email = ?',
        [decoded.email]
      );
      await conn.end();
      if (!rows.length) return res.status(403).json({ message: 'Account not found or deactivated.' });
      req.user = decoded;       // { email }
      req.account = rows[0];    // { email, is_admin }
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
/////////////////////////////////////////////////
//END HELPER FUNCTIONS AND AUTHENTICATION MIDDLEWARE
/////////////////////////////////////////////////


//////////////////////////////////////
//ROUTES TO HANDLE API REQUESTS
//////////////////////////////////////
// Route: Create Account
app.post('/api/create-account', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        const connection = await createConnection();
        const hashedPassword = await bcrypt.hash(password, 10);  // Hash password

        const [result] = await connection.execute(
            'INSERT INTO user (email, password) VALUES (?, ?)',
            [email, hashedPassword]
        );

        await connection.end();  // Close connection

        res.status(201).json({ message: 'Account created successfully!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ message: 'An account with this email already exists.' });
        } else {
            console.error(error);
            res.status(500).json({ message: 'Error creating account.' });
        }
    }
});

// Route: Logon
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    try {
        const connection = await createConnection();

        const [rows] = await connection.execute(
            'SELECT * FROM user WHERE email = ?',
            [email]
        );

        await connection.end();  // Close connection

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const user = rows[0];

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        console.log(token)

        res.status(200).json({ token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error logging in.' });
    }
});

// Route: Get All Email Addresses
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const connection = await createConnection();

        const [rows] = await connection.execute('SELECT email FROM user');

        await connection.end();  // Close connection

        const emailList = rows.map((row) => row.email);
        res.status(200).json({ emails: emailList });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error retrieving email addresses.' });
    }
});
//////////////////////////////////////
//END ROUTES TO HANDLE API REQUESTS
//////////////////////////////////////
// ========== INCOME ROUTES ==========

// Get all income (optionally filter by ?from=YYYY-MM-DD&to=YYYY-MM-DD)
app.get('/api/income', authenticateToken, async (req, res) => {
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

// Create income
app.post('/api/income', authenticateToken, async (req, res) => {
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

// Update income
app.patch('/api/income/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const fields = ['source','amount','cadence','date'];
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

// Delete income
app.delete('/api/income/:id', authenticateToken, async (req, res) => {
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


// ========== EXPENSE ROUTES ==========

// Get all expenses (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD)
app.get('/api/expenses', authenticateToken, async (req, res) => {
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

// Create expense
app.post('/api/expenses', authenticateToken, async (req, res) => {
  const { category, description = null, amount, date } = req.body;
  if (!category || amount == null || !date) {
    return res.status(400).json({ message: 'category, amount, and date are required' });
  }
  try {
    const conn = await createConnection();
    const [r] = await conn.execute(
      'INSERT INTO expense (user_email, category, description, amount, date) VALUES (?, ?, ?, ?, ?)',
      [req.user.email, String(category).trim(), description, Number(amount), date]
    );
    await conn.end();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error creating expense.' });
  }
});

// Update expense
app.patch('/api/expenses/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const fields = ['category','description','amount','date'];
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

// Delete expense
app.delete('/api/expenses/:id', authenticateToken, async (req, res) => {
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


// ========== OPTIONAL: SIMPLE REPORTS ==========
app.get('/api/reports', authenticateToken, async (req, res) => {
  const { from, to } = req.query;
  const range = (from && to) ? ' AND date BETWEEN ? AND ?' : '';
  const params = (from && to) ? [req.user.email, from, to] : [req.user.email];
  try {
    const conn = await createConnection();
    const [inc]  = await conn.execute(`SELECT IFNULL(SUM(amount),0) AS income  FROM income  WHERE user_email=?${range}`, params);
    const [exp]  = await conn.execute(`SELECT IFNULL(SUM(amount),0) AS expenses FROM expense WHERE user_email=?${range}`, params);
    const [cats] = await conn.execute(
      `SELECT category, SUM(amount) total FROM expense WHERE user_email=?${range} GROUP BY category ORDER BY total DESC`,
      params
    );
    await conn.end();
    res.json({
      totals: { income: Number(inc[0].income), expenses: Number(exp[0].expenses), net: Number(inc[0].income) - Number(exp[0].expenses) },
      expensesByCategory: cats
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Error building report.' });
  }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// ADMIN: list all users (emails + role)
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
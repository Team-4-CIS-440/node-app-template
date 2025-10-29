////////////////////////////////////////////////////////////////
//DASHBOARD.JS
//THIS IS YOUR "CONTROLLER", IT ACTS AS THE MIDDLEMAN
// BETWEEN THE MODEL (datamodel.js) AND THE VIEW (dashboard.html)
////////////////////////////////////////////////////////////////


//ADD ALL EVENT LISTENERS INSIDE DOMCONTENTLOADED
//AT THE BOTTOM OF DOMCONTENTLOADED, ADD ANY CODE THAT NEEDS TO RUN IMMEDIATELY
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const logoutButton = document.getElementById('logoutButton');
  const refreshButton = document.getElementById('refreshButton');

  // --- Events ---
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('jwtToken');   // fixed key
    window.location.href = '/';
  });

  refreshButton.addEventListener('click', () => {
    renderUserList();
  });

  // --- Auth guard + initial load ---
  const token = localStorage.getItem('jwtToken');
  if (!token) {
    window.location.href = '/';
  } else {
    DataModel.setToken(token);
    renderUserList();
  }
});

// --- Render helpers ---
async function renderUserList() {
  const userListElement = document.getElementById('userList');
  userListElement.innerHTML = '<div class="loading-message">Loading user list...</div>';

  try {
    const users = await DataModel.getUsers(); // protected call
    userListElement.innerHTML = '';           // clear before rendering

    if (!users || !users.length) {
      userListElement.innerHTML = '<div class="empty">No users found.</div>';
      return;
    }

    users.forEach(user => {
      const userItem = document.createElement('div');
      userItem.classList.add('user-item');
      userItem.textContent = user;            // e.g., "email@domain"
      userListElement.appendChild(userItem);
    });
  } catch (err) {
    // If token is bad/expired, bounce to login
    const msg = String(err?.message || '');
    if (msg.toLowerCase().includes('unauthorized') ||
        msg.toLowerCase().includes('expired') ||
        msg.includes('401') || msg.includes('403')) {
      localStorage.removeItem('jwtToken');
      window.location.href = '/';
      return;
    }
    userListElement.innerHTML = `<div class="error">${msg || 'Failed to load users.'}</div>`;
  }
}
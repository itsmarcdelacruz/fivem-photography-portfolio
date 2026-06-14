import './styles.css';
import { bootAdmin } from './app.js';
import { login } from './api.js';

function buildLoginForm(signInRoot) {
  const form   = document.createElement('form');
  form.id      = 'loginForm';
  form.className = 'login-form';

  const heading = document.createElement('h2');
  heading.textContent = 'Admin Sign In';

  const input = document.createElement('input');
  input.type     = 'password';
  input.id       = 'passwordInput';
  input.placeholder = 'Password';
  input.required = true;
  input.autocomplete = 'current-password';

  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.textContent = 'Sign in';

  const errorEl = document.createElement('p');
  errorEl.id        = 'loginError';
  errorEl.className = 'login-error';
  errorEl.textContent = 'Incorrect password.';
  errorEl.hidden    = true;

  form.append(heading, input, btn, errorEl);
  signInRoot.appendChild(form);
  return { form, errorEl };
}

async function init() {
  const signInRoot = document.getElementById('sign-in-root');
  const adminRoot  = document.getElementById('admin-root');

  if (localStorage.getItem('admin_token')) {
    signInRoot.hidden = true;
    adminRoot.hidden  = false;
    bootAdmin(adminRoot);
    return;
  }

  const { form, errorEl } = buildLoginForm(signInRoot);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.hidden = true;
    try {
      const password = document.getElementById('passwordInput').value;
      const { token } = await login(password);
      localStorage.setItem('admin_token', token);
      signInRoot.hidden = true;
      adminRoot.hidden  = false;
      bootAdmin(adminRoot);
    } catch {
      errorEl.hidden = false;
    }
  });
}

window.addEventListener('load', init);

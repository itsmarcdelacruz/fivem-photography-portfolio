import './styles.css';
import { bootAdmin } from './app.js';

async function init() {
  await window.Clerk.load();
  const signInRoot = document.getElementById('sign-in-root');
  const adminRoot  = document.getElementById('admin-root');
  if (!Clerk.user) { Clerk.mountSignIn(signInRoot); return; }
  signInRoot.hidden = true;
  adminRoot.hidden  = false;
  bootAdmin(adminRoot);
}

window.addEventListener('load', init);

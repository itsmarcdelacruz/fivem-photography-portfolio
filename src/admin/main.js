import './styles.css';

async function init() {
  await window.Clerk.load();
  const signInRoot = document.getElementById('sign-in-root');
  const adminRoot  = document.getElementById('admin-root');
  if (!Clerk.user) { Clerk.mountSignIn(signInRoot); return; }
  signInRoot.hidden = true;
  adminRoot.hidden  = false;
  adminRoot.textContent = 'Authenticated as ' + Clerk.user.primaryEmailAddress?.emailAddress;
}

window.addEventListener('load', init);

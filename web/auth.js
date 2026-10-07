(() => {
  let clerk = null;
  const signInPage = location.pathname === '/sign-in', signUpPage = location.pathname === '/sign-up';
  async function withDeadline(operation, milliseconds) {
    let timer;
    try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Sign-in is taking too long. Refresh to try again; published blueprints remain available.')), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  function localReturn() {
    const value = new URLSearchParams(location.search).get('return_to') || '/';
    try { const target = new URL(value, location.origin); if (value.startsWith('/') && !value.startsWith('//') && target.origin === location.origin && !['/sign-in', '/sign-up'].includes(target.pathname)) return target.pathname + target.search + target.hash; } catch {}
    return '/';
  }
  function authPage() {
    if (!signInPage && !signUpPage) return;
    document.querySelector('.intro').hidden = false;
    document.getElementById('pageTitle').textContent = signUpPage ? 'Create your account.' : 'Welcome back.';
    document.getElementById('introCopy').textContent = 'Your own account for the blueprint library and 100 free strategist replies.';
    document.getElementById('sectionLabel').textContent = 'BLUEPRINT LIBRARY';
    document.getElementById('pageStatus').textContent = '';
    document.getElementById('libraryGrid').hidden = true;
    document.getElementById('authPanel').hidden = false;
    document.getElementById('askTop').hidden = true;
  }
  const ready = (async () => {
    authPage();
    try {
      const response = await fetch('/api/auth/config', {signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('Sign-in is temporarily unavailable. Try again shortly.');
      const config = await response.json();
      if (!config.configured) throw Error('Sign-in is awaiting account configuration. You can still browse the published blueprints.');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Sign-in could not load. Check your connection and refresh.')), 15000);
        const script = document.createElement('script');
        script.src = config.scriptUrl;
        script.dataset.clerkPublishableKey = config.publishableKey;
        script.async = true; script.crossOrigin = 'anonymous';
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); reject(Error('Sign-in could not load. Check your connection and refresh.')); };
        document.head.append(script);
      });
      if (!window.Clerk) throw Error('Sign-in could not load. Refresh and try again.');
      clerk = window.Clerk;
      await withDeadline(clerk.load({publishableKey: config.publishableKey}), 15000);
      document.getElementById('accountLink').hidden = false;
      document.getElementById('accountLink').textContent = clerk.user ? 'Sign out' : 'Sign in';
      document.getElementById('accountLink').href = '/sign-in';
      if (clerk.user) document.getElementById('accountLink').onclick = event => {
        event.preventDefault(); void clerk.signOut({redirectUrl: location.origin + '/'});
      };
      if (signInPage || signUpPage) {
        const returnTo = localReturn();
        if (clerk.session) { location.replace(returnTo); return; }
        const options = {routing: 'hash', forceRedirectUrl: location.origin + returnTo,
          signInUrl: '/sign-in?return_to=' + encodeURIComponent(returnTo),
          signUpUrl: '/sign-up?return_to=' + encodeURIComponent(returnTo),
          appearance: {variables: {fontFamily: 'inherit'}}};
        if (signUpPage) clerk.mountSignUp(document.getElementById('authMount'), options);
        else clerk.mountSignIn(document.getElementById('authMount'), options);
      }
    } catch (error) {
      if (signInPage || signUpPage) {
        document.getElementById('authStatus').textContent = error.message;
        document.getElementById('authStatus').hidden = false;
      }
    }
  })();
  window.BlueprintAuth = {ready, isAuthPage: signInPage || signUpPage, async getToken() {
    try { return clerk?.session ? await clerk.session.getToken() : null; } catch { return null; }
  }};
})();

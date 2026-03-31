;(function () {
  var AUTH_KEY = 'oc_auth'

  function getAuth() {
    try {
      return JSON.parse(sessionStorage.getItem(AUTH_KEY))
    } catch (e) {
      return null
    }
  }

  function setAuth(user, pass) {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify({ u: user, p: pass }))
  }

  function clearAuth() {
    sessionStorage.removeItem(AUTH_KEY)
  }

  function makeBasic(user, pass) {
    return 'Basic ' + btoa(user + ':' + pass)
  }

  function createOverlay() {
    var overlay = document.createElement('div')
    overlay.id = 'auth-overlay'
    overlay.innerHTML = [
      '<div class="auth-bg"></div>',
      '<div class="auth-card">',
      '  <div class="auth-logo"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></div>',
      '  <h2 class="auth-title">OpenCode</h2>',
      '  <p class="auth-sub">Sign in to continue</p>',
      '  <form id="auth-form" autocomplete="off">',
      '    <div class="auth-field">',
      '      <input id="auth-user" type="text" placeholder="Username" autocomplete="username" required />',
      '    </div>',
      '    <div class="auth-field">',
      '      <input id="auth-pass" type="password" placeholder="Password" autocomplete="current-password" required />',
      '      <button type="button" id="auth-eye" tabindex="-1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>',
      '    </div>',
      '    <div id="auth-err" class="auth-err"></div>',
      '    <button type="submit" id="auth-btn">Sign In</button>',
      '  </form>',
      '</div>',
    ].join('')

    var s = document.createElement('style')
    s.textContent = [
      '#auth-overlay{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
      '.auth-bg{position:absolute;inset:0;background:linear-gradient(135deg,#0f0f0f 0%,#1a1a2e 50%,#16213e 100%)}',
      '.auth-card{position:relative;width:360px;max-width:90vw;padding:48px 36px 36px;background:rgba(255,255,255,0.04);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;text-align:center;box-shadow:0 32px 64px rgba(0,0,0,0.4)}',
      '.auth-logo{color:#e2e8f0;margin-bottom:12px}.auth-title{color:#f1f5f9;font-size:28px;font-weight:700;margin:0 0 4px;letter-spacing:-0.02em}.auth-sub{color:#94a3b8;font-size:14px;margin:0 0 32px}',
      '.auth-field{position:relative;margin-bottom:16px}',
      '.auth-field input{width:100%;padding:14px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#e2e8f0;font-size:15px;outline:none;transition:border-color .2s,box-shadow .2s;box-sizing:border-box}',
      '.auth-field input::placeholder{color:#64748b}',
      '.auth-field input:focus{border-color:rgba(99,102,241,0.5);box-shadow:0 0 0 3px rgba(99,102,241,0.15)}',
      '#auth-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;padding:4px;display:flex;transition:color .2s}',
      '#auth-eye:hover{color:#94a3b8}',
      '.auth-err{color:#f87171;font-size:13px;margin-bottom:12px;padding:8px 12px;background:rgba(248,113,113,0.08);border-radius:8px;border:1px solid rgba(248,113,113,0.15);display:none}',
      '#auth-btn{width:100%;padding:14px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s,transform .1s;margin-top:8px}',
      '#auth-btn:hover{opacity:.9}#auth-btn:active{transform:scale(.98)}#auth-btn:disabled{opacity:.5;cursor:not-allowed}',
      '@media(max-width:480px){.auth-card{padding:36px 24px 28px}}',
    ].join('')
    document.head.appendChild(s)
    document.body.appendChild(overlay)
    return overlay
  }

  function verify(user, pass) {
    return fetch('/auth/verify', {
      headers: { Authorization: makeBasic(user, pass) },
    }).then(function (r) {
      return r.ok
    })
  }

  function showLogin() {
    var overlay = createOverlay()
    var form = document.getElementById('auth-form')
    var userInput = document.getElementById('auth-user')
    var passInput = document.getElementById('auth-pass')
    var errDiv = document.getElementById('auth-err')
    var btn = document.getElementById('auth-btn')
    var eye = document.getElementById('auth-eye')

    eye.addEventListener('click', function () {
      passInput.type = passInput.type === 'password' ? 'text' : 'password'
    })

    userInput.focus()

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var user = userInput.value.trim()
      var pass = passInput.value
      if (!user || !pass) return

      btn.disabled = true
      btn.textContent = 'Verifying...'
      errDiv.style.display = 'none'

      verify(user, pass)
        .then(function (ok) {
          if (ok) {
            setAuth(user, pass)
            overlay.remove()
            window.dispatchEvent(new Event('auth-ready'))
          } else {
            errDiv.textContent = 'Invalid username or password'
            errDiv.style.display = 'block'
            btn.disabled = false
            btn.textContent = 'Sign In'
            passInput.value = ''
            passInput.focus()
          }
        })
        .catch(function () {
          errDiv.textContent = 'Connection failed'
          errDiv.style.display = 'block'
          btn.disabled = false
          btn.textContent = 'Sign In'
        })
    })
  }

  function init() {
    var auth = getAuth()
    if (auth) {
      return verify(auth.u, auth.p).then(function (ok) {
        if (!ok) {
          clearAuth()
          showLogin()
        }
      })
    }
    showLogin()
  }

  var _fetch = window.fetch
  window.fetch = function (url, options) {
    options = options || {}
    options.headers = options.headers || {}
    var auth = getAuth()
    if (auth) {
      if (typeof options.headers.append === 'function') {
        if (!options.headers.has('Authorization')) {
          options.headers.append('Authorization', makeBasic(auth.u, auth.p))
        }
      } else if (!options.headers['Authorization']) {
        options.headers['Authorization'] = makeBasic(auth.u, auth.p)
      }
    }
    return _fetch.apply(this, arguments)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()

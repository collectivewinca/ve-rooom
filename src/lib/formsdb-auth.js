/**
 * Central Google Auth via PocketBase — drop-in module.
 * Uses PB's built-in OAuth flow (zero per-domain Google Console config).
 * Auth host: https://formsdb.exe.xyz
 *
 * Usage:
 *   const auth = new FormsDBAuth();
 *   auth.onAuthChange(u => console.log(u));
 *   await auth.signInWithGoogle();   // popup
 *   await auth.signOut();
 */
class FormsDBAuth {
  constructor(opts = {}) {
    this.pbUrl = (opts.pbUrl || "https://formsdb.exe.xyz").replace(/\/+$/, "");
    this.collection = opts.collection || "users";
    this.redirectPath = opts.redirectPath || "/api/oauth2-callback";
    this.redirectUri = this.pbUrl + this.redirectPath;
    this.storeKey = opts.storeKey || "formsdb_auth_session";
    this._listeners = [];
    this._cachedProvider = null;
    this._restoreSession();
    this._prefetch();
    this._preconnect();
  }

  _restoreSession() {
    try {
      const raw = localStorage.getItem(this.storeKey);
      this._user = raw ? JSON.parse(raw) : null;
    } catch { this._user = null; }
  }

  _preconnect() {
    if (document.head) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = this.pbUrl;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
      const link2 = document.createElement("link");
      link2.rel = "preconnect";
      link2.href = "https://accounts.google.com";
      link2.crossOrigin = "anonymous";
      document.head.appendChild(link2);
    }
  }

  _prefetch() {
    this._getAuthMethods()
      .then((methods) => {
        this._cachedProvider = (methods.oauth2?.providers || methods.authProviders || []).find(
          (p) => p.name === "google"
        ) || null;
      })
      .catch(() => {});
  }

  onAuthChange(cb) {
    this._listeners.push(cb);
    cb(this._user);
    return () => { this._listeners = this._listeners.filter(f => f !== cb); };
  }
  _emit() { this._listeners.forEach(cb => cb(this._user)); }
  getUser() { return this._user; }

  async _getAuthMethods() {
    const res = await fetch(`${this.pbUrl}/api/collections/${this.collection}/auth-methods`);
    if (!res.ok) throw new Error(`auth-methods ${res.status}`);
    return res.json();
  }

  signInWithGoogle() {
    return new Promise(async (resolve, reject) => {
      let provider;
      try {
        const methods = await this._getAuthMethods();
        provider = (methods.oauth2?.providers || methods.authProviders || []).find(
          (p) => p.name === "google"
        );
        this._cachedProvider = provider;
      } catch (e) { return reject(e); }

      if (!provider?.authURL && !provider?.authUrl) {
        return reject(new Error("Google provider not configured on auth host"));
      }

      const authUrlBase = provider.authURL || provider.authUrl;
      const fullUrl = `${authUrlBase}${encodeURIComponent(this.redirectUri)}`;

      const popup = window.open(fullUrl, "google-auth", "width=500,height=650");
      if (!popup) return reject(new Error("Popup blocked"));

      const handler = (ev) => {
        if (ev.data?.type === "pb-oauth-code") {
          window.removeEventListener("message", handler);
          clearInterval(this._popupPoll);
          this._exchange(provider, ev.data.code, ev.data.state)
            .then(resolve).catch(reject);
        } else if (ev.data?.type === "pb-oauth-error") {
          window.removeEventListener("message", handler);
          clearInterval(this._popupPoll);
          reject(new Error(ev.data.error || "OAuth error"));
        }
      };
      window.addEventListener("message", handler);

      this._popupPoll = setInterval(() => {
        if (popup.closed) {
          clearInterval(this._popupPoll);
          window.removeEventListener("message", handler);
          reject(new Error("Popup closed before completing login"));
        }
      }, 500);
    });
  }

  async _exchange(provider, code, state) {
    const res = await fetch(`${this.pbUrl}/api/collections/${this.collection}/auth-with-oauth2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        code,
        codeVerifier: provider.codeVerifier,
        redirectUrl: this.redirectUri,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token || !data.record) {
      throw new Error(data.message || "Token exchange failed");
    }
    const user = {
      token: data.token,
      record: data.record,
      meta: data.meta || {},
      email: data.record.email,
      name: data.record.name || data.record.username || data.record.email,
      avatarURL: data.record.avatarURL || data.meta?.rawUser?.picture || data.meta?.avatarURL || data.record.avatar || "",
      id: data.record.id,
      googleProfile: data.meta?.rawUser || data.meta || null,
    };
    this._user = user;
    localStorage.setItem(this.storeKey, JSON.stringify(user));
    this._trackLogin(data.token, data.record.id, data.meta, data.record);
    this._emit();
    return user;
  }

  async _trackLogin(token, recordId, meta, record) {
    try {
      const rawGoogle = meta?.rawUser || {};
      const patchBody = {
        loginOrigin: window.location.origin,
        lastLoginAt: new Date().toISOString().replace("T", " ").substring(0, 19) + "Z",
        lastLoginMethod: "google",
        googleProfile: {
          sub: rawGoogle.sub || "",
          email: rawGoogle.email || record.email || "",
          email_verified: rawGoogle.email_verified || rawGoogle.emailVerified || false,
          name: rawGoogle.name || record.name || "",
          given_name: rawGoogle.given_name || "",
          family_name: rawGoogle.family_name || "",
          picture: rawGoogle.picture || "",
          locale: rawGoogle.locale || "",
          hd: rawGoogle.hd || "",
        },
      };
      if (rawGoogle.name && !record.name) patchBody.name = rawGoogle.name;
      if (rawGoogle.picture && !record.avatarURL) patchBody.avatarURL = rawGoogle.picture;

      await fetch(`${this.pbUrl}/api/collections/${this.collection}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify(patchBody),
      });

      const current = await fetch(`${this.pbUrl}/api/collections/${this.collection}/records/${recordId}`, {
        headers: { Authorization: token },
      }).then(r => r.json()).catch(() => ({}));
      const newCount = (current.loginCount || 0) + 1;
      await fetch(`${this.pbUrl}/api/collections/${this.collection}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ loginCount: newCount }),
      });
    } catch {}
  }

  async refresh() {
    if (!this._user?.token) return null;
    const res = await fetch(`${this.pbUrl}/api/collections/${this.collection}/auth-refresh`, {
      headers: { Authorization: this._user.token },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { this.signOut(); return null; }
    const user = { ...this._user, token: data.token, record: data.record };
    this._user = user;
    localStorage.setItem(this.storeKey, JSON.stringify(user));
    this._emit();
    return user;
  }

  async signOut() {
    localStorage.removeItem(this.storeKey);
    this._user = null;
    this._emit();
  }

  async api(path, opts = {}) {
    if (!this._user?.token) throw new Error("Not authenticated");
    return fetch(path, { ...opts, headers: { ...opts.headers, Authorization: this._user.token } });
  }
}

export default FormsDBAuth;
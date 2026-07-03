# Authentication

VE Rooom uses a **central Google OAuth gateway** powered by PocketBase. This allows any project on any domain to get Google login with zero per-domain Google Console configuration.

## How It Works

```
ve-rooom.pages.dev                    formsdb.exe.xyz (PocketBase)
    │                                     │
    │  1. GET /auth-methods ─────────────►  returns Google authURL + PKCE verifier
    │  2. window.open(authURL) ─────────►  Google consent popup
    │     Google redirects ──────────────►  /api/oauth2-callback (PB hook)
    │                                        → postMessage(code) to opener
    │  3. POST /auth-with-oauth2 ─────────►  PB exchanges code with Google
    │                                        → returns PB token + user
    │  4. PATCH /records/{id} ──────────►  saves loginOrigin, loginCount, profile
    │
    └── User logged in — PB token in localStorage
```

- PocketBase is the OAuth client (holds Google client_id + secret)
- Google Console has ONE redirect URI: `https://formsdb.exe.xyz/api/oauth2-callback`
- The PB hook renders HTML that does `postMessage(payload, "*")` — works cross-domain

## Files

| File | Purpose |
|---|---|
| `src/lib/formsdb-auth.js` | Drop-in auth module (zero dependencies) |
| `src/lib/formsdb-auth.d.ts` | TypeScript type declarations |
| `src/lib/useAuth.ts` | React hook for auth state |
| `src/components/Layout.tsx` | Navbar with sign-in button / avatar / sign-out |

## Usage

### In a React component

```tsx
import { useAuth } from "../lib/useAuth";

function MyComponent() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <button onClick={signInWithGoogle}>Sign in</button>;

  return (
    <div>
      <img src={user.avatarURL} alt={user.name} />
      <span>{user.name}</span>
      <button onClick={signOut}>Sign out</button>
    </div>
  );
}
```

### API Reference

| Method | Returns | Description |
|---|---|---|
| `useAuth()` | `{ user, loading, signInWithGoogle, signOut }` | React hook |
| `user` | `AuthUser \| null` | Current user (auto-restored from localStorage) |
| `loading` | `boolean` | True on first render before auth state resolves |
| `signInWithGoogle()` | `Promise<AuthUser>` | Opens popup, exchanges code, returns user |
| `signOut()` | `Promise<void>` | Clears localStorage, emits null |

### AuthUser type

```ts
interface AuthUser {
  token: string;       // PocketBase auth token
  email: string;       // Google email
  name: string;        // Google display name
  avatarURL: string;   // Google profile picture URL
  id: string;          // PocketBase record ID
}
```

## Data Storage

### Browser
- `localStorage` key `formsdb_auth_session`: `{ token, record, email, name, avatarURL, id, googleProfile }`
- Session persists across page refreshes
- Cleared on sign-out

### PocketBase (`formsdb.exe.xyz`)
- `users` collection stores: email, name, avatarURL, googleProfile (full Google payload), loginOrigin (which domain), loginCount, lastLoginAt, lastLoginMethod

## Configuration

The auth module defaults to `https://formsdb.exe.xyz`. To override:

```ts
import FormsDBAuth from "./lib/formsdb-auth.js";

const auth = new FormsDBAuth({
  pbUrl: "https://your-pocketbase.example.com",
  collection: "users",
  storeKey: "custom_session_key",
});
```

## Current Deployment

| Item | Value |
|---|---|
| Auth host | `https://formsdb.exe.xyz` (PocketBase 0.38.0) |
| Google client_id | `822914084371-cj9e7715s3dhkuahbk2dt3amrja3i3s2.apps.googleusercontent.com` |
| Redirect URI | `https://formsdb.exe.xyz/api/oauth2-callback` |
| Superuser | `formsdb-admin@collectivewin.ca` |

## Pitfalls

1. **Popup blockers** — `signInWithGoogle()` must be called from a user click (not programmatically)
2. **Avatar URL** — Google's profile picture is in `meta.rawUser.picture`, not `record.avatarURL`. The module checks both.
3. **referrerPolicy** — Google profile images require `referrerPolicy="no-referrer"` on the `<img>` tag to load correctly
4. **Expired tokens** — If the PB token expires, the next API call returns 401. Call `auth.refresh()` or sign in again.
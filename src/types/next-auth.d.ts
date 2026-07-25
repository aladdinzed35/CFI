import type { AccountStatus, Locale, Role } from '@prisma/client';

/**
 * Module augmentation for Auth.js v5 — so that `session.user.role` is a `Role`
 * and not a guess, and so that nothing in the auth layer ever needs `any`.
 *
 * ## Why `@auth/core/*` and not `next-auth`
 * `next-auth` does not *declare* `Session`, `User` or `JWT`; it re-exports them
 * (`export type { Session, User } from "@auth/core/types"`). A declaration merge
 * has to target the module that actually declares the interface, otherwise it
 * quietly creates a second, unrelated interface and every field stays missing.
 * Augmenting `@auth/core/types` and `@auth/core/jwt` therefore reaches both
 * packages at once — `import type { Session } from 'next-auth'` sees these
 * fields too.
 *
 * ## Required versus optional
 * `Session['user']` is **required and fully typed**: by the time a session
 * object exists, `session.ts` has resolved a live `Session` row and every field
 * is known. `User` and `JWT` extras are optional, because those two shapes also
 * describe intermediate states — the object Auth.js hands to the `jwt` callback
 * on the very first hop, a token decoded from a cookie issued before a field
 * existed. The callbacks in `server/auth/config.ts` narrow them explicitly
 * rather than pretending they are always there.
 *
 * `sessionToken` is the raw opaque session token (only its SHA-256 is stored,
 * see `session.ts`). It travels from `authorize()` into the **encrypted** Auth.js
 * JWT and is deliberately absent from `Session['user']`: nothing rendered in a
 * page or serialised to a client component should ever be able to read it.
 */

declare module '@auth/core/types' {
  /** The object `authorize()` returns and the `jwt` callback receives on sign-in. */
  interface User {
    fullName?: string;
    role?: Role;
    status?: AccountStatus;
    locale?: Locale;
    avatarKey?: string | null;
    /** `Session.id` of the row minted for this login. */
    sessionId?: string;
    /** Raw session token. Never leaves the encrypted JWT. */
    sessionToken?: string;
  }

  interface Session {
    user: {
      id: string;
      fullName: string;
      email: string;
      role: Role;
      status: AccountStatus;
      locale: Locale;
      avatarKey: string | null;
      /** The `Session` row backing this login, for « Déconnecter cet appareil ». */
      sessionId: string;
    };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    /** `Session.id` — the revocation handle. */
    sid?: string;
    /** Raw session token, resolved against the `Session` table on every request. */
    stk?: string;
    fullName?: string;
    role?: Role;
    status?: AccountStatus;
    locale?: Locale;
    avatarKey?: string | null;
  }
}

export {};

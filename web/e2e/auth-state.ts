// Session (cookie) files: auth.setup.ts logs each user in ONCE and writes them; spec files read them
// instead of logging in themselves. Login is limited to 10 attempts per minute per IP, and per-file logins
// exceeded that on a full run (spurious CI failures). The files hold session cookies and are git-ignored.
export const USER1_STATE = 'e2e/.auth/user1.json'
export const USER2_STATE = 'e2e/.auth/user2.json'

export const hasUser1 = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD)
export const hasUser2 = Boolean(process.env.E2E_EMAIL2 && process.env.E2E_PASSWORD2)

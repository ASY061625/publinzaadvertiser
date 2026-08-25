import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticate } from "@/lib/data/accounts";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // JWT sessions rather than database sessions: the Credentials provider does
  // not support the database strategy. Adding magic links later means bringing
  // in the Prisma adapter and its Account/Session tables at that point.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const actor = await authenticate(email, password);
        if (!actor) return null;

        return { id: actor.id, email: actor.email, role: actor.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.uid ?? "");
        session.user.role = (token.role as string) ?? "ADVERTISER";
      }
      return session;
    },
  },
});

import { router, route, z, body, actx, need } from "../http/route";
import { login, registerCitizen, logoutEverywhere, publicUser, enrolFamily, listFamilies, switchFamily } from "../services/auth";
import { getActor, ipKey } from "../http/middleware";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

export const authRoutes = router();

const Login = z.object({ email: z.string().min(3).openapi({ example: "officer@asli.demo" }), password: z.string().min(4).openapi({ example: "demo1234" }) }).openapi("LoginRequest");
authRoutes.openapi(route({ method: "post", path: "/auth/login", tags: ["Auth"], summary: "Sign in (returns a JWT)", body: Login, auth: false }), async (c) => {
  const b = body(c, Login);
  return c.json(await login(c.get("db"), b.email, b.password, ipKey(c)), 200);
});

const Register = z
  .object({
    fullName: z.string().min(2),
    phone: z.string().regex(/^(\+92|0)3\d{9}$/).openapi({ example: "03001234567" }),
    password: z.string().min(6),
    pin: z.string().regex(/^\d{4,6}$/).optional().openapi({ description: "Family PIN used when a helper assists on a shared phone" }),
    email: z.string().email().optional(),
    fatherName: z.string().optional(),
    cnic: z.string().optional(),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    district: z.string().optional(),
    language: z.enum(["ur", "en"]).optional(),
    payoutAlias: z.string().optional().openapi({ description: "Mock Raast alias: mobile 03xxxxxxxxx" }),
    tenantSlug: z.string().optional(),
  })
  .openapi("RegisterCitizen");
authRoutes.openapi(route({ method: "post", path: "/auth/register", tags: ["Auth"], summary: "Citizen self sign-up", body: Register, auth: false, status: 201 }), async (c) => {
  return c.json(await registerCitizen(c.get("db"), body(c, Register)), 201);
});

authRoutes.openapi(route({ method: "get", path: "/auth/me", tags: ["Auth"], summary: "Current user, role and (for helpers) the active family session" }), async (c) => {
  const a = getActor(c);
  if (a.type !== "user") return c.json({ actor: a }, 200);
  const [u] = await c.get("db").select().from(users).where(eq(users.id, a.id));
  return c.json({ user: publicUser(u!), actingFor: c.get("actFor") ?? null }, 200);
});

authRoutes.openapi(route({ method: "post", path: "/auth/logout-all", tags: ["Auth"], summary: "Revoke every session for this account" }), async (c) => c.json(await logoutEverywhere(c.get("db"), getActor(c)), 200));

// ───────── helper mode ─────────

const Enrol = z
  .object({
    fullName: z.string().min(2),
    fatherName: z.string().optional(),
    cnic: z.string().optional(),
    dob: z.string().optional(),
    phone: z.string().optional(),
    district: z.string().optional(),
    payoutAlias: z.string().optional(),
    pin: z.string().regex(/^\d{4,6}$/).openapi({ description: "Chosen and typed by the family member, not the helper" }),
    spokenConsent: z.string().min(2).openapi({ description: "Transcript of the family member agreeing aloud", example: "Haan, main ijazat deti hoon" }),
  })
  .openapi("EnrolFamily");
authRoutes.openapi(route({ method: "post", path: "/helper/families", tags: ["Helper mode"], summary: "Enrol a family on the shared phone (family sets PIN, consents aloud)", body: Enrol, status: 201 }), async (c) => {
  const actor = await need(c, ["helper"]);
  return c.json(await enrolFamily(c.get("db"), actor, body(c, Enrol)), 201);
});

authRoutes.openapi(route({ method: "get", path: "/helper/families", tags: ["Helper mode"], summary: "Families this helper may assist (masked until PIN switch)" }), async (c) => {
  const actor = await need(c, ["helper"]);
  return c.json({ families: await listFamilies(c.get("db"), actor) }, 200);
});

const Switch = z.object({ citizenId: z.string(), pin: z.string().regex(/^\d{4,6}$/) }).openapi("SwitchFamily");
authRoutes.openapi(
  route({
    method: "post",
    path: "/helper/switch",
    tags: ["Helper mode"],
    summary: "Switch to a family with their PIN → 20-minute family token",
    description: "Returns a token that can act ONLY for this family. Consent is re-checked on every request, so a withdrawal stops it immediately. 5 wrong PINs lock the family for 15 minutes.",
    body: Switch,
  }),
  async (c) => {
    const actor = await need(c, ["helper"]);
    const b = body(c, Switch);
    return c.json(await switchFamily(c.get("db"), actor, b.citizenId, b.pin), 200);
  },
);

export { actx };

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is not set");
}
if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
}

export async function verifySupabaseToken(token: string) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: serviceRoleKey,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Supabase /auth/v1/user failed: ${res.status} ${text || ""}`.trim()
    );
  }

  const user = (await res.json()) as { id: string };

  if (!user.id) {
    throw new Error("Supabase user response missing id");
  }

  // id = auth.users.id
  return {
    id: user.id,
    payload: user,
  };
}

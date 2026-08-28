import { eq } from "@/app/lib/db/supabase";
import { userScoped } from "@/app/lib/db/user-scope";

type UserRoleRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export async function isAdminUser(userId: string): Promise<boolean> {
  if (!userId.trim()) {
    return false;
  }
  const roles = await userScoped<UserRoleRow[]>(userId, "user_roles", {
    query: {
      role: eq("admin"),
      select: "id,user_id,role,created_at",
      limit: "1"
    }
  });
  return Boolean(roles[0]);
}

export type Profile = { id: string; name: string; chat_id: string; archived: number };
export type Category = { id: string; name: string; archived: number };
export type Expense = {
  id: string;
  item: string;
  amount: number;
  occurred_at: number;
  category: string;
  category_id: string;
};
export type Data = { profiles: Profile[]; categories: Category[]; expenses: Expense[] };

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchData(params: {
  profile: string;
  start: string;
  end: string;
  category?: string;
}): Promise<Data> {
  const start = Date.parse(`${params.start}T00:00:00+07:00`);
  const end = Date.parse(`${params.end}T00:00:00+07:00`) + 86400000;
  const query = new URLSearchParams({
    profile: params.profile,
    start: String(start),
    end: String(end),
    category: params.category ?? "",
  });
  const response = await fetch(`/api/data?${query}`);
  if (response.status === 401) throw new ApiError(401, "Sesi berakhir. Silakan masuk lagi.");
  const result = (await response.json().catch(() => null)) as (Data & { error?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, result?.error || "Data tidak dapat dimuat.");
  if (!result) throw new ApiError(response.status, "Data tidak dapat dimuat.");
  return result;
}

export async function getProfiles(): Promise<Profile[]> {
  const today = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
    .slice(0, 10);
  const result = await fetchData({ profile: "", start: today, end: today });
  return result.profiles;
}

export async function postAction(
  profileId: string,
  action: string,
  values: Record<string, unknown> = {},
): Promise<{ id?: string }> {
  const response = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, profileId, ...values }),
  });
  if (response.status === 401) throw new ApiError(401, "Sesi berakhir. Silakan masuk lagi.");
  const result = (await response.json().catch(() => null)) as { error?: string; id?: string } | null;
  if (!response.ok)
    throw new ApiError(response.status, result?.error || "Perubahan tidak dapat disimpan.");
  return result ?? {};
}

export async function loginRequest(username: string, password: string): Promise<boolean> {
  const response = await fetch("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return response.ok;
}

export async function signOutRequest(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST" });
}

export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
  });
  if (!response.ok)
    return { ok: false, error: "Kata sandi tidak dapat diubah. Periksa kata sandi saat ini." };
  return { ok: true };
}

export async function recoverRequest(token: string, password: string): Promise<boolean> {
  const response = await fetch("/api/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  return response.ok;
}

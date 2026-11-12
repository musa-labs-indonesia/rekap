export const queryKeys = {
  profiles: ["profiles"] as const,
  channels: ["channels"] as const,
  spend: (profileId: string, start: string, end: string, category: string) =>
    ["spend", profileId, start, end, category] as const,
  spendProfile: (profileId: string) => ["spend", profileId] as const,
};

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getProfiles, signOutRequest } from "./api";
import type { Profile } from "./api";
import { queryKeys } from "./query-keys";

type AppContextValue = {
  signedIn: boolean | null;
  profiles: Profile[];
  selectedProfile: Profile | undefined;
  selectedProfileId: string;
  selectProfile: (id: string) => void;
  loadingProfiles: boolean;
  error: string;
  completeLogin: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  logout: () => void;
  logoutPending: boolean;
  handleUnauthorized: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [selectedProfileId, setSelectedProfileIdState] = useState("");

  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    enabled: signedIn !== false,
    retry: false,
  });

  const profiles = profilesQuery.data ?? [];

  const selectProfile = useCallback((id: string) => {
    setSelectedProfileIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem("rekap.profile", id);
  }, []);

  const clearSession = useCallback(() => {
    setSelectedProfileIdState("");
    setSignedIn(false);
    if (typeof window !== "undefined") window.localStorage.removeItem("rekap.profile");
    queryClient.clear();
  }, [queryClient]);

  const completeLogin = useCallback(async () => {
    setSignedIn(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
  }, [queryClient]);

  const refreshProfiles = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
  }, [queryClient]);

  const logoutMutation = useMutation({
    mutationFn: signOutRequest,
    onSettled: clearSession,
    retry: false,
  });

  useEffect(() => {
    if (signedIn === null && profilesQuery.isSuccess) setSignedIn(true);
  }, [signedIn, profilesQuery.isSuccess]);

  useEffect(() => {
    if (!profilesQuery.isError) return;
    if (profilesQuery.error instanceof ApiError && profilesQuery.error.status === 401) {
      clearSession();
      return;
    }
    setSignedIn(false);
  }, [profilesQuery.isError, profilesQuery.error, clearSession]);

  useEffect(() => {
    if (!profilesQuery.data) return;
    setSelectedProfileIdState((current) => {
      if (current && profilesQuery.data.some((profile) => profile.id === current)) return current;
      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem("rekap.profile") : "";
      const next =
        profilesQuery.data.find((profile) => profile.id === stored)?.id ??
        profilesQuery.data.find((profile) => !profile.archived)?.id ??
        profilesQuery.data[0]?.id ??
        "";
      if (typeof window !== "undefined" && next)
        window.localStorage.setItem("rekap.profile", next);
      return next;
    });
  }, [profilesQuery.data]);

  const unauthorized =
    profilesQuery.error instanceof ApiError && profilesQuery.error.status === 401;
  const error =
    profilesQuery.isError && !unauthorized && profilesQuery.error instanceof Error
      ? profilesQuery.error.message
      : "";

  const value = useMemo<AppContextValue>(
    () => ({
      signedIn,
      profiles,
      selectedProfile: profiles.find((profile) => profile.id === selectedProfileId),
      selectedProfileId,
      selectProfile,
      loadingProfiles: profilesQuery.isFetching,
      error,
      completeLogin,
      refreshProfiles,
      logout: () => logoutMutation.mutate(),
      logoutPending: logoutMutation.isPending,
      handleUnauthorized: clearSession,
    }),
    [
      signedIn,
      profiles,
      selectedProfileId,
      selectProfile,
      profilesQuery.isFetching,
      error,
      completeLogin,
      refreshProfiles,
      logoutMutation.isPending,
      clearSession,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

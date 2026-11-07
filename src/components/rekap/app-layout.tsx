import { useEffect, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CircleAlert,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Shapes,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { AppProvider, useApp } from "./app-provider";
import { BrandMark } from "./brand-mark";
import { LoginScreen } from "./login-screen";
import { PasswordDialog } from "./password-dialog";

export function AppLayout() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <BrandMark />
        <div className="mt-8 flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </main>
  );
}

function AppShell() {
  const { signedIn, profiles, loadingProfiles, completeLogin } = useApp();
  if (signedIn === null) return <LoadingScreen />;
  if (!signedIn) return <LoginScreen onLoggedIn={completeLogin} />;
  if (loadingProfiles && !profiles.length) return <LoadingScreen />;
  return (
    <SidebarProvider className="min-h-svh bg-background p-0 md:p-3">
      <ShellContent />
    </SidebarProvider>
  );
}

function ShellContent() {
  const {
    profiles,
    selectedProfileId,
    selectProfile,
    error,
    logout,
    logoutPending,
  } = useApp();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setOpenMobile } = useSidebar();
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    setOpenMobile(false);
    document.getElementById("rekap-main")?.scrollTo({ top: 0 });
  }, [pathname, setOpenMobile]);

  const navigation = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, active: pathname === "/" },
    {
      to: "/transactions",
      label: "Transaksi",
      icon: ReceiptText,
      active: pathname.startsWith("/transactions"),
    },
    {
      to: "/categories",
      label: "Kategori",
      icon: Shapes,
      active: pathname.startsWith("/categories"),
    },
    {
      to: "/profiles",
      label: "Profil",
      icon: Users,
      active: pathname.startsWith("/profiles"),
    },
  ] as const;

  return (
    <>
      <div className="mx-auto flex h-svh w-full max-w-[1600px] overflow-hidden border-0 bg-card md:h-[calc(100dvh-1.5rem)] md:rounded-3xl md:border md:shadow-[0_1px_2px_var(--shadow-soft)]">
        <Sidebar
          collapsible="none"
          className="h-full shrink-0 border-r border-sidebar-border bg-sidebar"
        >
          <SidebarHeader className="p-5">
            <Link to="/" className="block rounded-lg" onClick={() => setOpenMobile(false)}>
              <BrandMark />
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu</SidebarGroupLabel>
              <SidebarGroupContent>
                <nav aria-label="Navigasi utama">
                  <SidebarMenu>
                    {navigation.map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton asChild size="lg" isActive={item.active}>
                          <Link to={item.to} onClick={() => setOpenMobile(false)}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Profil aktif</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="px-2">
                  <Select value={selectedProfileId} onValueChange={selectProfile}>
                    <SelectTrigger id="profile-select" className="w-full" aria-label="Profil aktif">
                      <SelectValue placeholder="Pilih profil" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                            {profile.archived ? " (arsip)" : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-3">
            <nav aria-label="Utilitas">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild size="lg">
                    <Link to="/docs">
                      <BookOpen />
                      <span>Panduan</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg" onClick={() => setPasswordOpen(true)}>
                    <KeyRound />
                    <span>Ubah kata sandi</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg" onClick={logout} disabled={logoutPending}>
                    <LogOut />
                    <span>Keluar</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset id="rekap-main" className="h-full min-w-0 overflow-y-auto bg-background">
          {error ? (
            <div className="px-4 pt-4 md:px-8">
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Profil tidak dapat dimuat</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          <Outlet />
        </SidebarInset>
      </div>
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

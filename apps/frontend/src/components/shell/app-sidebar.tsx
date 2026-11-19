"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Download, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { Mark } from "@/components/mark";
import { NAV } from "@/lib/shell";
import { isIOS, isInstalled, watchInstallability, type BeforeInstallPromptEvent } from "@/lib/install";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialsOf, useAccount, useSignOut } from "./shell-actions";

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The active page carries a 2px rule in the one accent colour, not a filled
// pill: the rule is the marker, the text stays on the ground.
const ITEM =
  "relative h-9 text-muted-foreground hover:text-foreground data-[active=true]:bg-transparent data-[active=true]:text-foreground data-[active=true]:font-medium before:absolute before:inset-y-2 before:left-0 before:w-[2px] data-[active=true]:before:bg-primary [&>svg]:size-[18px]";

export function AppSidebar() {
  const pathname = usePathname();
  const primary = NAV.slice(0, -1);
  const settings = NAV[NAV.length - 1];

  return (
    <Sidebar collapsible="icon" aria-label="Main">
      <SidebarHeader className="h-12 justify-center px-3 group-data-[collapsible=icon]:px-2">
        <Link
          href="/today"
          className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight"
          aria-label="Study Tracker, today"
        >
          <span aria-hidden="true" className="flex shrink-0">
            <Mark size={24} />
          </span>
          <span className="truncate text-[14px] group-data-[collapsible=icon]:hidden">Study Tracker</span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <SidebarMenu>
            {primary.map((item) => (
              <NavItem key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator className="mx-3 data-[orientation=horizontal]:w-auto" />
        <SidebarGroup>
          <SidebarMenu>
            <NavItem item={settings} active={isActive(pathname, settings.href)} />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <SidebarMenu>
          <ThemeItem />
          <InstallItem />
          <AccountItem />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavItem({ item, active }: { item: (typeof NAV)[number]; active: boolean }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label} className={ITEM}>
        <Link href={item.href} aria-current={active ? "page" : undefined}>
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeRadio() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

function ThemeItem() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // The stored theme is unknown on the server; guessing would mismatch hydration.
  useEffect(() => setMounted(true), []);
  const key = (mounted && theme && theme in THEME_ICON ? theme : "system") as keyof typeof THEME_ICON;
  const Icon = THEME_ICON[key];
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip="Theme" className={ITEM}>
            <Icon aria-hidden="true" />
            <span>Theme</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-40">
          <ThemeRadio />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function InstallItem() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<"none" | "ready" | "ios" | "installed">("none");

  useEffect(() => {
    if (isInstalled()) return setState("installed");
    if (isIOS()) setState("ios");
    return watchInstallability({
      onAvailable: (e) => {
        setPrompt(e);
        setState("ready");
      },
      onInstalled: () => {
        setPrompt(null);
        setState("installed");
      },
    });
  }, []);

  if (state !== "ready" && state !== "ios") return null;

  async function install() {
    if (state === "ios") {
      toast("Install from Safari", { description: "Open Share, then Add to Home Screen.", duration: 8000 });
      return;
    }
    if (!prompt) return;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        setState("installed");
        toast.success("Installed. Open it from your home screen.");
      }
    } catch {
      toast.error("The browser would not open the install prompt. Use its menu instead.");
    } finally {
      // The browser never replays this event, so a second press would do nothing.
      setPrompt(null);
      setState((s) => (s === "installed" ? s : "none"));
    }
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Install app" className={ITEM} onClick={install}>
        <Download aria-hidden="true" />
        <span>Install app</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AccountMenuItems() {
  const account = useAccount();
  const signOut = useSignOut();
  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground truncate font-normal">
        {account.data?.email ?? (account.isError ? "Account" : "Loading account")}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/settings">
          <Settings aria-hidden="true" />
          Settings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void signOut()}>
        <LogOut aria-hidden="true" />
        Sign out
      </DropdownMenuItem>
    </>
  );
}

export function AccountAvatar({ className }: { className?: string }) {
  const account = useAccount();
  return (
    <Avatar aria-hidden="true" className={cn("size-6 rounded-md", className)}>
      <AvatarFallback className="bg-accent text-foreground rounded-md text-[12px] font-semibold">
        {initialsOf(account.data?.email)}
      </AvatarFallback>
    </Avatar>
  );
}

function AccountItem() {
  const account = useAccount();
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip="Account" className={cn(ITEM, "[&>span:last-child]:text-[13px]")}>
            <AccountAvatar className="-ml-1 group-data-[collapsible=icon]:ml-0" />
            <span>{account.data?.email ?? "Account"}</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-60">
          <AccountMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

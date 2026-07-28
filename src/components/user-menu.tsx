import { Link } from "@tanstack/react-router";
import { Check, Languages, LogOut, Settings, User as UserIcon } from "lucide-react";

import { useAuth } from "@/routes/__root";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/locale-provider";

function initialsFromEmail(email?: string | null): string {
  if (!email) return "?";
  const [local] = email.split("@");
  if (!local) return "?";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

const LOCALE_LABEL_KEY: Record<Locale, string> = {
  en: "common.english",
  ar: "common.arabic",
};

export function UserMenu() {
  const { user, signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const email = user?.email ?? "";
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    email.split("@")[0] ??
    t("common.signIn");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label={t("common.accountMenu")}
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
              {initialsFromEmail(email)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          {email && (
            <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/profile" className="flex cursor-pointer items-center gap-2">
            <UserIcon className="h-4 w-4" />
            <span>{t("common.profile")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings/company" className="flex cursor-pointer items-center gap-2">
            <Settings className="h-4 w-4" />
            <span>{t("common.settings")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Languages className="h-4 w-4" />
            <span>{t("common.language")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LOCALES.map((code) => (
              <DropdownMenuItem
                key={code}
                onSelect={() => setLocale(code)}
                className="gap-2"
                data-testid={`locale-${code}`}
              >
                <Check
                  className={`h-4 w-4 ${code === locale ? "opacity-100" : "opacity-0"}`}
                  aria-hidden
                />
                <span>{t(LOCALE_LABEL_KEY[code])}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
          className="gap-2 text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span>{t("common.signOut")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

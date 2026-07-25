import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle, Loader2, Trash2, Upload, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { supabase } from "@/integrations/supabase/client";
import {
  getProfileSettings,
  updateProfile,
  getAvatarUploadTarget,
  setProfileAvatar,
  removeProfileAvatar,
  updateNotificationPrefs,
  LOCALES,
  type Locale,
  type NotificationPrefsRow,
  type ProfileRow,
} from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  head: () => ({
    meta: [
      { title: "Profile settings — GridMind EPC" },
      {
        name: "description",
        content:
          "Manage your GridMind EPC profile: name, avatar, locale, and notification preferences.",
      },
      { property: "og:title", content: "Profile settings — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Manage your GridMind EPC profile: name, avatar, locale, and notification preferences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsProfilePage,
});

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  pt: "Português",
};

const profileFormSchema = z.object({
  full_name: z.string().trim().min(2, "At least 2 characters").max(80),
  locale: z.enum(LOCALES),
});
type ProfileForm = z.infer<typeof profileFormSchema>;

const prefsFormSchema = z.object({
  email_enabled: z.boolean(),
  in_app_enabled: z.boolean(),
  prefs: z.object({
    approvals: z.boolean(),
    mentions: z.boolean(),
    invites: z.boolean(),
    report_delivery: z.boolean(),
    alarm_escalation: z.boolean(),
  }),
});
type PrefsForm = z.infer<typeof prefsFormSchema>;

const EVENT_ITEMS: Array<{
  key: keyof PrefsForm["prefs"];
  label: string;
  description: string;
}> = [
  {
    key: "approvals",
    label: "Approvals",
    description: "When something is waiting on your approval or is approved.",
  },
  {
    key: "mentions",
    label: "Mentions",
    description: "When you're @mentioned in comments or discussions.",
  },
  {
    key: "invites",
    label: "Invite & member status",
    description: "Invite accepted, revoked, or role changed.",
  },
  {
    key: "report_delivery",
    label: "Report delivery",
    description: "Scheduled reports and exports are ready.",
  },
  {
    key: "alarm_escalation",
    label: "Alarm escalation",
    description: "Critical O&M / SCADA alarms escalated to you.",
  },
];

function SettingsProfilePage() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getProfileSettings);

  const settingsQuery = useQuery({
    queryKey: ["profile-settings"],
    queryFn: () => fetchSettings(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["profile-settings"] });

  if (settingsQuery.isLoading) {
    return (
      <div className="page-shell max-w-3xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <div className="page-shell max-w-3xl">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Couldn't load your profile
            </CardTitle>
            <CardDescription>
              {(settingsQuery.error as Error | undefined)?.message ?? "Something went wrong."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => settingsQuery.refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { profile, avatarSignedUrl, notificationPrefs } = settingsQuery.data;

  return (
    <div className="page-shell max-w-3xl">
      <PageHeader
        title="Profile settings"
        description="Manage your name, avatar, language, and notification preferences."
      />

      <ProfileCard profile={profile} avatarSignedUrl={avatarSignedUrl} onSaved={invalidate} />

      <NotificationsCard prefs={notificationPrefs} onSaved={invalidate} />
    </div>
  );
}

function ProfileCard({
  profile,
  avatarSignedUrl,
  onSaved,
}: {
  profile: ProfileRow;
  avatarSignedUrl: string | null;
  onSaved: () => void;
}) {
  const submitFn = useServerFn(updateProfile);
  const getTargetFn = useServerFn(getAvatarUploadTarget);
  const setAvatarFn = useServerFn(setProfileAvatar);
  const removeAvatarFn = useServerFn(removeProfileAvatar);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarSignedUrl);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setAvatarPreview(avatarSignedUrl), [avatarSignedUrl]);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      full_name: profile.full_name ?? "",
      locale: (LOCALES as readonly string[]).includes(profile.locale)
        ? (profile.locale as Locale)
        : "en",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: ProfileForm) => submitFn({ data: values }),
    onSuccess: (res) => {
      toast.success(res.changed === 0 ? "No changes to save" : "Profile saved");
      form.reset(form.getValues());
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to save"),
  });

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Avatar must be an image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Avatar must be 2 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const target = await getTargetFn();
      setAvatarPreview(URL.createObjectURL(file));
      const { error } = await supabase.storage.from(target.bucket).upload(target.path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: "0",
      });
      if (error) throw error;
      const res = await setAvatarFn({ data: { path: target.path } });
      if (res.signedUrl) setAvatarPreview(res.signedUrl);
      toast.success("Avatar uploaded");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const removeMutation = useMutation({
    mutationFn: () => removeAvatarFn(),
    onSuccess: () => {
      setAvatarPreview(null);
      toast.success("Avatar removed");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to remove"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name, avatar, and preferred language.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3">
          <Label>Avatar</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Your avatar" className="h-full w-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {avatarPreview ? "Replace avatar" : "Upload avatar"}
              </Button>
              {avatarPreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate()}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG or SVG. Max 2 MB.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Email</Label>
          <Input value={profile.email ?? ""} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            Email is managed by your identity provider and can't be changed here.
          </p>
        </div>

        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="locale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Language</FormLabel>
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as Locale)}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LOCALES.map((l) => (
                        <SelectItem key={l} value={l}>
                          {LOCALE_LABELS[l]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save profile
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function NotificationsCard({
  prefs,
  onSaved,
}: {
  prefs: NotificationPrefsRow;
  onSaved: () => void;
}) {
  const submitFn = useServerFn(updateNotificationPrefs);

  const form = useForm<PrefsForm>({
    resolver: zodResolver(prefsFormSchema),
    defaultValues: {
      email_enabled: prefs.email_enabled,
      in_app_enabled: prefs.in_app_enabled,
      prefs: prefs.prefs,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: PrefsForm) => submitFn({ data: values }),
    onSuccess: () => {
      toast.success("Notification preferences saved");
      form.reset(form.getValues());
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to save"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose how and when GridMind reaches out to you.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-6" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <div className="grid gap-4">
              <FormField
                control={form.control}
                name="email_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start justify-between gap-4 rounded-md border border-border bg-card p-4">
                    <div className="grid gap-1">
                      <FormLabel className="text-base">Email notifications</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Marketing emails can also be stopped via the unsubscribe link in any email
                        footer.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="in_app_enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start justify-between gap-4 rounded-md border border-border bg-card p-4">
                    <div className="grid gap-1">
                      <FormLabel className="text-base">In-app notifications</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Show notifications in the bell menu.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-3">
              <Label className="text-sm text-foreground">Notify me about</Label>
              <div className="grid gap-3">
                {EVENT_ITEMS.map((item) => (
                  <FormField
                    key={item.key}
                    control={form.control}
                    name={`prefs.${item.key}` as const}
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start gap-3 rounded-md border border-border bg-card p-3">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <div className="grid gap-0.5">
                          <FormLabel className="cursor-pointer">{item.label}</FormLabel>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save preferences
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

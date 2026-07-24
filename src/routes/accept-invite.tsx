import { useEffect, useState } from "react";
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import {
  peekInvite,
  peekInviteAnonymous,
  redeemInviteRpc,
  type AnonPeekResult,
} from "@/lib/invites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const searchSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const Route = createFileRoute("/accept-invite")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Accept invitation | GridMind EPC" },
      {
        name: "description",
        content: "Accept your invitation to join a GridMind EPC workspace.",
      },
      { property: "og:title", content: "Accept invitation | GridMind EPC" },
      {
        property: "og:description",
        content: "Accept your invitation to join a GridMind EPC workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AcceptInvitePage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="font-display text-2xl font-bold tracking-tight text-foreground">
            GridMind EPC
          </span>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}

function MessageCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-4 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Link
        to="/"
        className="text-sm font-medium text-primary hover:underline"
      >
        Back to home
      </Link>
    </div>
  );
}

function renderStateCard(result: AnonPeekResult) {
  if (result.status === "invalid") {
    return (
      <MessageCard
        title="Invitation not valid"
        body="This invitation link isn't valid. Ask your administrator for a new one."
      />
    );
  }
  if (result.status === "expired") {
    return (
      <MessageCard
        title="Invitation expired"
        body="Ask your admin to resend it."
      />
    );
  }
  if (result.status === "revoked") {
    return (
      <MessageCard
        title="Invitation revoked"
        body="This invitation has been revoked. Ask your administrator for a new one."
      />
    );
  }
  return null;
}

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setHasSession(!!data.session),
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (hasSession === null) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  return hasSession ? (
    <SignedInAccept token={token} />
  ) : (
    <AnonymousAccept token={token} />
  );
}

function AnonymousAccept({ token }: { token: string }) {
  const peekFn = useServerFn(peekInviteAnonymous);
  const peek = useQuery({
    queryKey: ["invite-peek-anon", token],
    queryFn: () => peekFn({ data: { token } }),
    retry: false,
  });

  if (peek.isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (peek.isError || !peek.data) {
    return (
      <Shell>
        <MessageCard
          title="Something went wrong"
          body={
            peek.error instanceof Error
              ? peek.error.message
              : "We couldn't load this invitation."
          }
        />
      </Shell>
    );
  }

  const state = renderStateCard(peek.data);
  if (state) return <Shell>{state}</Shell>;

  const invite = peek.data as Extract<AnonPeekResult, { status: "valid" }>;
  return <AnonymousEnroll token={token} invite={invite} />;
}

const passwordSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(100),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[0-9]/, "Include at least one number"),
});
type PasswordValues = z.infer<typeof passwordSchema>;

function AnonymousEnroll({
  token,
  invite,
}: {
  token: string;
  invite: Extract<AnonPeekResult, { status: "valid" }>;
}) {
  const redirectPath = `/accept-invite?token=${token}`;
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { fullName: "", password: "" },
  });
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const onSetPassword = async (values: PasswordValues) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: invite.email,
        password: values.password,
        options: {
          data: { full_name: values.fullName },
          emailRedirectTo: `${window.location.origin}${redirectPath}`,
        },
      });
      if (error) throw error;
      // If email confirmations are disabled, session is created immediately
      // and the effect on the parent will re-render into SignedInAccept.
      toast.success("Account created — accepting invitation…");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    try {
      await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/login?redirect=${encodeURIComponent(
          redirectPath,
        )}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleLoading(false);
    }
  };

  return (
    <Shell>
      <div className="flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Join {invite.companyName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;ve been invited as{" "}
            <span className="font-medium text-foreground">
              {invite.role.replace(/_/g, " ")}
            </span>
            .
          </p>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSetPassword)}
            className="flex flex-col gap-3"
          >
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input placeholder="Your name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input value={invite.email} readOnly disabled />
              </FormControl>
            </FormItem>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Set a password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create account &amp; join
            </Button>
          </form>
        </Form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onGoogle}
          disabled={googleLoading}
        >
          {googleLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue with Google
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            search={{ redirect: redirectPath }}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </Shell>
  );
}

function SignedInAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const peekFn = useServerFn(peekInvite);
  const redeemFn = useServerFn(redeemInviteRpc);

  const peek = useQuery({
    queryKey: ["invite-peek", token],
    queryFn: () => peekFn({ data: { token } }),
    retry: false,
  });

  const redeem = useMutation({
    mutationFn: () => redeemFn({ data: { token } }),
    onSuccess: () => {
      toast.success("Invitation accepted");
      queryClient.invalidateQueries();
      router.invalidate();
      navigate({ to: "/dashboard", replace: true });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not accept invite");
    },
  });

  if (peek.isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (peek.isError || !peek.data) {
    return (
      <Shell>
        <MessageCard
          title="Something went wrong"
          body={
            peek.error instanceof Error
              ? peek.error.message
              : "We couldn't load this invitation."
          }
        />
      </Shell>
    );
  }

  const result = peek.data;

  if (result.status !== "valid" && result.status !== "wrong_account") {
    return <Shell>{renderStateCard(result as AnonPeekResult)}</Shell>;
  }

  if (result.status === "wrong_account") {
    return (
      <Shell>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Wrong account
          </h1>
          <p className="text-sm text-muted-foreground">
            This invitation was sent to{" "}
            <span className="font-medium text-foreground">
              {result.invitedEmail}
            </span>
            . Sign out and sign in with that account to accept it.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              await supabase.auth.signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Join {result.companyName}
        </h1>
        <p className="text-sm text-muted-foreground">
          You&apos;ve been invited to{" "}
          <span className="font-medium text-foreground">
            {result.companyName}
          </span>{" "}
          as{" "}
          <span className="font-medium text-foreground">
            {result.role.replace(/_/g, " ")}
          </span>
          .
        </p>
        <Button onClick={() => redeem.mutate()} disabled={redeem.isPending}>
          {redeem.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Accept invitation
        </Button>
      </div>
    </Shell>
  );
}

import { useEffect, useState } from "react";
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { peekInvite, redeemInviteRpc } from "@/lib/invites.functions";
import { Button } from "@/components/ui/button";

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

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
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

  const redirectPath = `/accept-invite?token=${token}`;

  if (hasSession === null) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  if (!hasSession) {
    return (
      <Shell>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Sign in to accept your invitation
          </h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ll be redirected back here after signing in.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() =>
                navigate({
                  to: "/login",
                  search: { redirect: redirectPath },
                })
              }
            >
              Sign in
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  to: "/signup",
                  search: { redirect: redirectPath },
                })
              }
            >
              Create account
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return <SignedInAccept token={token} onDone={() => {
    queryClient.invalidateQueries();
    router.invalidate();
    navigate({ to: "/dashboard", replace: true });
  }} />;
}

function SignedInAccept({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
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
      onDone();
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

  if (result.status === "invalid") {
    return (
      <Shell>
        <MessageCard
          title="Invitation not valid"
          body="This invitation link isn't valid. Ask your administrator for a new one."
        />
      </Shell>
    );
  }

  if (result.status === "expired") {
    return (
      <Shell>
        <MessageCard
          title="Invitation expired"
          body="This invitation has expired. Ask your administrator to resend it."
        />
      </Shell>
    );
  }

  if (result.status === "revoked") {
    return (
      <Shell>
        <MessageCard
          title="Invitation revoked"
          body="This invitation has been revoked. Ask your administrator for a new one."
        />
      </Shell>
    );
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
        <Button
          onClick={() => redeem.mutate()}
          disabled={redeem.isPending}
        >
          {redeem.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Accept invitation
        </Button>
      </div>
    </Shell>
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

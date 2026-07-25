import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
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

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});
type Values = z.infer<typeof schema>;

export const Route = createFileRoute("/(auth)/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password | GridMind EPC" },
      {
        name: "description",
        content: "Request a password reset link for your GridMind EPC account.",
      },
      { property: "og:title", content: "Reset password | GridMind EPC" },
      {
        property: "og:description",
        content: "Request a password reset link for your GridMind EPC account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: Values) => {
    setPending(true);
    // Fire-and-forget: never reveal whether the email exists.
    await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-foreground">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Check your inbox</h1>
          <p className="text-sm text-muted-foreground">
            If an account exists for that email, we&apos;ve sent a link to reset your password.
          </p>
        </div>
        <Link to="/login" className="text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Forgot password</h1>
        <p className="text-sm text-muted-foreground">
          Enter the email on your account and we&apos;ll send a reset link.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reset link
          </Button>
        </form>
      </Form>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

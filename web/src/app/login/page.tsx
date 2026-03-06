"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_SCOPES = [
  "cbam:read",
  "cbam:write",
  "narrative:run",
  "review:write",
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [sub, setSub] = useState("dev-user");
  const [tenantId, setTenantId] = useState("dev-org");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { access_token } = await login(sub, tenantId, DEFAULT_SCOPES);
      saveToken(access_token);
      document.cookie = `cbam_token=${access_token}; path=/; max-age=3600`;
      const next = searchParams.get("next") ?? "/";
      router.push(next);
    } catch (err) {
      toast({
        title: "Login failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 mb-2">
            <span className="text-2xl">🌿</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">CBAM Platform</h1>
          <p className="text-slate-400 text-sm">Carbon Border Adjustment Mechanism Reporting</p>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Sign in</CardTitle>
            <CardDescription className="text-slate-400">
              Dev mode — enter any user ID and tenant to generate a JWT.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sub" className="text-slate-300">User ID</Label>
                <Input
                  id="sub"
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder="dev-user"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tenant" className="text-slate-300">Tenant / Org ID</Label>
                <Input
                  id="tenant"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder="dev-org"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-medium"
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

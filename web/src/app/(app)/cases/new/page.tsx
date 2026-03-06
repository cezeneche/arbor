"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createCbamCase } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

const CURRENT_YEAR = new Date().getFullYear();

export default function NewCasePage() {
  const router = useRouter();
  const { toast } = useToast();

  const [eori, setEori] = useState("");
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [quarter, setQuarter] = useState<"1" | "2" | "3" | "4">("1");

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createCbamCase({
        importer_eori: eori,
        importer_name: name || undefined,
        reporting_year: Number(year),
        reporting_quarter: Number(quarter) as 1 | 2 | 3 | 4,
      }),
    onSuccess: (c) => {
      toast({ title: "Case created", description: `ID: ${c.id}` });
      router.push(`/cases/${c.id}`);
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-lg space-y-6">
      <Link href="/cases" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to cases
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white">New CBAM Case</h1>
        <p className="text-slate-400 text-sm mt-1">Create a new CBAM reporting case</p>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-base">Importer details</CardTitle>
          <CardDescription className="text-slate-400">The EU importer responsible for this CBAM declaration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">EORI Number *</Label>
            <Input
              value={eori}
              onChange={(e) => setEori(e.target.value)}
              placeholder="GB123456789000"
              className="bg-slate-800 border-slate-700 text-white font-mono"
              required
            />
            <p className="text-xs text-slate-500">EU Economic Operators Registration and Identification number</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Company name (optional)</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Steel GmbH"
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-base">Reporting period</CardTitle>
          <CardDescription className="text-slate-400">CBAM declarations are submitted quarterly.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Year</Label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              min={2024}
              max={2100}
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Quarter</Label>
            <Select value={quarter} onValueChange={(v) => setQuarter(v as "1" | "2" | "3" | "4")}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {(["1", "2", "3", "4"] as const).map((q) => (
                  <SelectItem key={q} value={q} className="text-white hover:bg-slate-700">Q{q}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          onClick={() => mutate()}
          disabled={isPending || !eori}
          className="bg-teal-600 hover:bg-teal-500 text-white"
        >
          {isPending ? "Creating…" : "Create Case"}
        </Button>
        <Link href="/cases">
          <Button variant="ghost" className="text-slate-400 hover:text-white">Cancel</Button>
        </Link>
      </div>
    </div>
  );
}

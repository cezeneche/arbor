"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getReportPackage, getReview, approveCase, rejectCase } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ReviewDecisionPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reviewerName, setReviewerName] = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [comments, setComments] = useState("");

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ["report-package", id],
    queryFn: () => getReportPackage(id),
  });

  const { data: reviewState } = useQuery({
    queryKey: ["review", id],
    queryFn: () => getReview(id),
  });

  const { mutate: approve, isPending: approving } = useMutation({
    mutationFn: () => approveCase(id, { reviewer_name: reviewerName, reviewer_email: reviewerEmail, comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cbam-cases"] });
      toast({ title: "Case approved", description: "The case has been signed off." });
      router.push("/review");
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { mutate: reject, isPending: rejecting } = useMutation({
    mutationFn: () => rejectCase(id, { reviewer_name: reviewerName, reviewer_email: reviewerEmail, comments }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cbam-cases"] });
      toast({ title: "Case rejected", description: "Operator will be notified." });
      router.push("/review");
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const alreadyDecided = reviewState?.review_status === "approved" || reviewState?.review_status === "rejected";
  const formValid = reviewerName && reviewerEmail;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/review" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to review queue
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white">Review Decision</h1>
        <p className="text-slate-400 text-sm mt-1 font-mono">{id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Narrative (left 2/3) */}
        <div className="lg:col-span-2">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">Compliance narrative</CardTitle>
            </CardHeader>
            <CardContent>
              {reportLoading ? (
                <div className="space-y-2">
                  {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-4 bg-slate-800" />)}
                </div>
              ) : report?.narrative ? (
                <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                  <ReactMarkdown>{report.narrative}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-slate-500 text-sm">No narrative available yet. Run the pipeline first.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Decision form (right 1/3) */}
        <div className="space-y-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">Reviewer details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Full name *</Label>
                <Input
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  placeholder="Jane Smith"
                  disabled={alreadyDecided}
                  className="bg-slate-800 border-slate-700 text-white text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Email *</Label>
                <Input
                  type="email"
                  value={reviewerEmail}
                  onChange={(e) => setReviewerEmail(e.target.value)}
                  placeholder="j.smith@eu.int"
                  disabled={alreadyDecided}
                  className="bg-slate-800 border-slate-700 text-white text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">Comments (required for rejection)</Label>
                <Textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Add any notes or reasons…"
                  disabled={alreadyDecided}
                  rows={4}
                  className="bg-slate-800 border-slate-700 text-white text-sm resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {alreadyDecided ? (
            <div className="p-4 bg-slate-800 rounded-lg border border-slate-700 text-center">
              <p className="text-slate-300 text-sm capitalize">Decision: {reviewState?.review_status}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                onClick={() => approve()}
                disabled={approving || rejecting || !formValid}
                className="w-full bg-green-600 hover:bg-green-500 text-white gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                {approving ? "Approving…" : "Approve"}
              </Button>
              <Button
                onClick={() => reject()}
                disabled={approving || rejecting || !formValid || !comments}
                variant="outline"
                className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 gap-2"
              >
                <XCircle className="w-4 h-4" />
                {rejecting ? "Rejecting…" : "Reject"}
              </Button>
              <p className="text-xs text-slate-500 text-center">Comments required to reject.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

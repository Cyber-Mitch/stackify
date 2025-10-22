import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { projectId, publicAnonKey } from "../utils/supabase/info";

interface WaitlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WaitlistDialog({ open, onOpenChange }: WaitlistDialogProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes("@")) {
      setStatus("error");
      setMessage("Please enter a valid email address");
      return;
    }

    setLoading(true);
    setStatus("idle");

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-7871649b/waitlist`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error || "Failed to join waitlist");
      } else {
        setStatus("success");
        setMessage(data.message || "Successfully joined the waitlist!");
        setEmail("");
        
        // Close dialog after 2 seconds on success
        setTimeout(() => {
          onOpenChange(false);
          setStatus("idle");
          setMessage("");
        }, 2000);
      }
    } catch (error) {
      console.error("Waitlist submission error:", error);
      setStatus("error");
      setMessage("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] bg-clip-text text-transparent">
            Join the Waitlist
          </DialogTitle>
          <DialogDescription>
            Be the first to know when Stackify launches. Enter your email below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading || status === "success"}
              required
            />
          </div>

          {status === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              <span>{message}</span>
            </div>
          )}

          {status === "success" && (
            <div className="flex items-center gap-2 text-sm text-[var(--zk-green)]">
              <CheckCircle2 className="w-4 h-4" />
              <span>{message}</span>
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-[var(--stacks-purple)] to-[var(--zk-green)] hover:opacity-90"
            disabled={loading || status === "success"}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Joining...
              </>
            ) : status === "success" ? (
              "Joined!"
            ) : (
              "Join Waitlist"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

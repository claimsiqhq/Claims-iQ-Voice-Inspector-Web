import { useState, useRef } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Camera, Loader2, Save, User, Mail, Briefcase, Shield } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { AuthUser } from "@/contexts/AuthContext";

export default function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(user?.fullName || "");
  const [title, setTitle] = useState(user?.title || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const profileMutation = useMutation({
    mutationFn: async (data: { fullName?: string; title?: string }) => {
      const res = await apiRequest("PATCH", "/api/profile", data);
      return res.json() as Promise<AuthUser>;
    },
    onSuccess: (data) => {
      updateProfile({ fullName: data.fullName, title: data.title });
      toast({ title: "Profile updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await apiRequest("POST", "/api/profile/avatar", {
        base64Data: base64,
        mimeType: file.type,
      });
      return res.json() as Promise<AuthUser>;
    },
    onSuccess: (data) => {
      updateProfile({ avatarUrl: data.avatarUrl });
      setAvatarPreview(null);
      toast({ title: "Photo updated" });
    },
    onError: (err: Error) => {
      setAvatarPreview(null);
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please use JPG, PNG, or WebP", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 5MB", variant: "destructive" });
      return;
    }

    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
    avatarMutation.mutate(file);
    e.target.value = "";
  }

  function handleSave() {
    const updates: { fullName?: string; title?: string } = {};
    if (fullName.trim() && fullName !== user?.fullName) updates.fullName = fullName.trim();
    if (title !== (user?.title || "")) updates.title = title.trim();
    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }
    profileMutation.mutate(updates);
  }

  const initials = (user?.fullName || user?.email || "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleLabels: Record<string, string> = {
    admin: "Administrator",
    supervisor: "Supervisor",
    adjuster: "Field Adjuster",
  };

  return (
    <Layout title="My Profile" showBack>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="p-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative group">
              <Avatar className="h-28 w-28 border-4 border-primary/20" data-testid="img-avatar-large">
                <AvatarImage src={avatarPreview || user?.avatarUrl || undefined} />
                <AvatarFallback className="text-2xl font-semibold bg-primary/10 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <button
                data-testid="button-change-avatar"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarMutation.isPending}
                className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {avatarMutation.isPending ? (
                  <Loader2 className="h-6 w-6 text-white animate-spin" />
                ) : (
                  <Camera className="h-6 w-6 text-white" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold" data-testid="text-profile-name">{user?.fullName || "Set your name"}</h2>
              <p className="text-sm text-muted-foreground" data-testid="text-profile-title">{user?.title || "No title set"}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-5">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Profile Information
          </h3>
          <Separator />

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                Full Name
              </Label>
              <Input
                id="fullName"
                data-testid="input-fullname"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title" className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                Job Title
              </Label>
              <Input
                id="title"
                data-testid="input-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Field Adjuster"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Email
              </Label>
              <Input
                data-testid="input-email-readonly"
                value={user?.email || ""}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Role
              </Label>
              <Input
                data-testid="input-role-readonly"
                value={roleLabels[user?.role || ""] || user?.role || ""}
                disabled
                className="bg-muted"
              />
            </div>
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button
              data-testid="button-save-profile"
              onClick={handleSave}
              disabled={profileMutation.isPending}
              className="gap-2"
            >
              {profileMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

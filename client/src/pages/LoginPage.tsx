import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Mail, Lock, User } from "lucide-react";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("signin");

  async function handleSignIn() {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password, rememberMe);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password, fullName, username.trim() || undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #342A4F 0%, #7763B7 100%)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-display font-bold text-white mb-2">Claims IQ</h1>
          <p className="text-gray-300">Smart property inspection workflows</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Register</TabsTrigger>
            </TabsList>

            {error && (
              <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            <TabsContent value="signin">
              <form onSubmit={(e) => { e.preventDefault(); handleSignIn(); }} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4" /> Email or username
                </label>
                <Input
                  type="text"
                  placeholder="adjuster@demo.claimsiq.com or adjuster"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-gray-300"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <Lock className="h-4 w-4" /> Password
                </label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-gray-300"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember-me"
                  data-testid="checkbox-remember-me"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                />
                <label
                  htmlFor="remember-me"
                  className="text-sm font-medium text-gray-600 cursor-pointer select-none"
                >
                  Remember me
                </label>
              </div>

              <Button
                data-testid="button-signin"
                type="submit"
                disabled={loading}
                className="w-full"
                style={{ backgroundColor: "#7763B7" }}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign In
              </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={(e) => { e.preventDefault(); handleSignUp(); }} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <User className="h-4 w-4" /> Full Name
                </label>
                <Input
                  type="text"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="border-gray-300"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <User className="h-4 w-4" /> Username
                </label>
                <Input
                  type="text"
                  placeholder="johndoe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="border-gray-300"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4" /> Email
                </label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-gray-300"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <Lock className="h-4 w-4" /> Password
                </label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border-gray-300"
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
                style={{ backgroundColor: "#7763B7" }}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Account
              </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="text-center text-gray-400 text-xs mt-8">
          Claims IQ - Enterprise Property Inspection
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { login } from "@/api/auth-login.js";
import logoUrl from "../assets/images/logo.png";

export function AuthLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { token } = await login(username, password);
      localStorage.setItem("auth_token", token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="w-full max-w-[380px]">
        <div className="mb-6 text-center">
          <img
            src={logoUrl}
            alt="Clawbot"
            className="mx-auto size-16 rounded-section object-cover"
          />
          <p className="mt-3 text-xs uppercase tracking-label-xl text-muted">Clawbot</p>
          <h1 className="mt-1.5 text-4xl text-ink">登录</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <div className="border border-notice-error-border bg-notice-error-bg px-3 py-2 text-base text-red-700">
              {error}
            </div>
          )}

          <Input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />

          <Input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <Button type="submit" className="mt-1 w-full rounded-lg" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

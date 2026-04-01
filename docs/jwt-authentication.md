# JWT 认证系统设计

## 概述

将现有的固定 `API_SECRET` 认证方案升级为基于 JWT Token + config.yaml 配置的认证系统。

## 目标

1. 移除硬编码的 `API_SECRET` 环境变量
2. 支持用户名密码登录，从 config.yaml 读取配置
3. 使用 JWT Token 进行无状态认证
4. 可选：集成 Redis 实现 token 复用和主动注销

## 架构设计

### 认证流程

```
┌─────────┐                           ┌─────────┐
│   Web   │                           │  Server │
└────┬────┘                           └────┬────┘
     │                                     │
     │ 1. POST /api/auth/login            │
     │    {username, password}            │
     ├───────────────────────────────────>│
     │                                     │ 2. 验证 config.yaml
     │                                     │    中的账号密码
     │                                     │
     │ 3. 返回 JWT token                  │
     │    {token, expiresIn}              │
     │<───────────────────────────────────┤
     │                                     │
     │ 4. 存储 token 到 localStorage      │
     │                                     │
     │ 5. 后续请求携带 JWT                │
     │    Authorization: Bearer <token>   │
     ├───────────────────────────────────>│
     │                                     │ 6. 验证 JWT 签名
     │                                     │    和过期时间
     │                                     │
     │ 7. 返回数据                        │
     │<───────────────────────────────────┤
```

## 配置文件

### config.yaml 结构

```yaml
# data/config.yaml
auth:
  username: admin
  password: your-secure-password  # 明文或 bcrypt hash
  jwtSecret: random-secret-key-change-me-in-production
  tokenExpiry: 24h  # 支持: 1h, 24h, 7d 等
```

### 配置说明

- `username`: 登录用户名
- `password`: 登录密码（初期支持明文，后续可升级为 bcrypt hash）
- `jwtSecret`: JWT 签名密钥，必须保密
- `tokenExpiry`: Token 有效期，默认 24 小时

## Server 端实现

### 1. 依赖安装

```bash
pnpm add jsonwebtoken js-yaml
pnpm add -D @types/jsonwebtoken @types/js-yaml
```

### 2. 配置加载模块

**文件**: `packages/server/src/config/auth.ts`

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  tokenExpiry: string;
}

export function loadAuthConfig(): AuthConfig {
  const configPath = resolve(process.cwd(), "data/config.yaml");
  const content = readFileSync(configPath, "utf-8");
  const config = yaml.load(content) as { auth: AuthConfig };

  if (!config.auth) {
    throw new Error("Missing auth configuration in config.yaml");
  }

  return config.auth;
}
```

### 3. JWT 工具模块

**文件**: `packages/server/src/auth/jwt.ts`

```typescript
import jwt from "jsonwebtoken";
import type { AuthConfig } from "../config/auth.js";

export interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

export function generateToken(username: string, config: AuthConfig): string {
  const expiry = parseExpiry(config.tokenExpiry);

  return jwt.sign(
    { username },
    config.jwtSecret,
    { expiresIn: expiry }
  );
}

export function verifyToken(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([hdm])$/);
  if (!match) return 86400; // 默认 24h

  const [, num, unit] = match;
  const value = parseInt(num, 10);

  switch (unit) {
    case "h": return value * 3600;
    case "d": return value * 86400;
    case "m": return value * 60;
    default: return 86400;
  }
}
```

### 4. 认证路由

**文件**: `packages/server/src/api/routes/auth.ts`

```typescript
import type { Hono } from "hono";
import type { AuthConfig } from "../../config/auth.js";
import { generateToken } from "../../auth/jwt.js";

export function registerAuthRoutes(app: Hono, authConfig: AuthConfig) {
  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json();
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: "Missing username or password" }, 400);
    }

    if (username !== authConfig.username || password !== authConfig.password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const token = generateToken(username, authConfig);

    return c.json({
      data: {
        token,
        expiresIn: authConfig.tokenExpiry,
      }
    });
  });
}
```

### 5. 认证中间件

**文件**: `packages/server/src/api/middleware/auth.ts`

```typescript
import type { MiddlewareHandler } from "hono";
import { verifyToken } from "../../auth/jwt.js";

export function createAuthMiddleware(jwtSecret: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);

    try {
      const payload = verifyToken(token, jwtSecret);
      c.set("user", payload.username);
      await next();
    } catch (error) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
  };
}
```

### 6. 修改 API 入口

**文件**: `packages/server/src/api/index.ts`

修改现有的 auth middleware 和路由注册：

```typescript
import { loadAuthConfig } from "../config/auth.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { registerAuthRoutes } from "./routes/auth.js";

export function createApiApp(dependencies: ApiDependencies) {
  const app = new Hono();
  const authConfig = loadAuthConfig();

  app.use("*", cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
  app.use("*", logger());

  // 注册认证路由（不需要 token）
  registerAuthRoutes(app, authConfig);

  // 其他路由需要 JWT 认证
  app.use("/api/*", createAuthMiddleware(authConfig.jwtSecret));

  // 注册其他路由...
  registerHealthRoutes(app, dependencies);
  registerAccountRoutes(app);
  // ...

  return app;
}
```

## Web 端实现

### 1. 登录页面

**文件**: `packages/web/src/pages/Login.tsx`

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const { token } = await login(username, password);
      localStorage.setItem("auth_token", token);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="login-container">
      <form onSubmit={handleSubmit}>
        <h1>Login</h1>
        {error && <div className="error">{error}</div>}
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit">Login</button>
      </form>
    </div>
  );
}
```

### 2. 修改 API 客户端

**文件**: `packages/web/src/lib/api.ts`

```typescript
// 移除 API_SECRET
// const API_SECRET = import.meta.env.VITE_API_SECRET;

function getAuthToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type") && init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  // 使用 localStorage 中的 token
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401) {
    // Token 过期或无效，跳转到登录页
    localStorage.removeItem("auth_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const payload = await response.json().catch(() => ({ error: "invalid response" }));

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `request failed with status ${response.status}`);
  }

  return payload.data as T;
}

// 新增登录 API
export function login(username: string, password: string): Promise<{ token: string; expiresIn: string }> {
  return request<{ token: string; expiresIn: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}
```

### 3. 路由保护

**文件**: `packages/web/src/App.tsx`

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("auth_token");
  return token ? <>{children}</> : <Navigate to="/login" />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
```

## 迁移步骤

### 阶段 1: Server 端实现

1. 安装依赖: `jsonwebtoken`, `js-yaml`
2. 创建 `data/config.yaml` 配置文件
3. 实现配置加载模块 (`config/auth.ts`)
4. 实现 JWT 工具模块 (`auth/jwt.ts`)
5. 创建认证路由 (`api/routes/auth.ts`)
6. 创建认证中间件 (`api/middleware/auth.ts`)
7. 修改 `api/index.ts` 集成新的认证系统
8. 测试登录接口和 token 验证

### 阶段 2: Web 端实现

1. 创建登录页面组件
2. 修改 API 客户端，移除 `VITE_API_SECRET`
3. 实现路由保护逻辑
4. 处理 token 过期自动跳转
5. 测试完整登录流程

### 阶段 3: 清理

1. 删除 `packages/server/.env` 中的 `API_SECRET`
2. 删除 `packages/web/.env` 中的 `VITE_API_SECRET`
3. 更新 `.env.example` 文件
4. 更新 README 文档

## 可选增强：Redis 集成

### Redis Token 管理

如果需要支持主动注销和 token 复用，可以集成 Redis：

```typescript
// packages/server/src/auth/redis-token.ts
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });

export async function storeToken(username: string, token: string, expiry: number) {
  await redis.setEx(`auth:token:${username}`, expiry, token);
}

export async function getActiveToken(username: string): Promise<string | null> {
  return await redis.get(`auth:token:${username}`);
}

export async function revokeToken(username: string) {
  await redis.del(`auth:token:${username}`);
}
```

修改登录逻辑，先检查是否有未过期的 token：

```typescript
app.post("/api/auth/login", async (c) => {
  // 验证密码...

  // 检查是否有活跃 token
  const existingToken = await getActiveToken(username);
  if (existingToken) {
    try {
      verifyToken(existingToken, authConfig.jwtSecret);
      return c.json({ data: { token: existingToken, expiresIn: authConfig.tokenExpiry } });
    } catch {
      // token 已过期，生成新的
    }
  }

  const token = generateToken(username, authConfig);
  await storeToken(username, token, parseExpiry(authConfig.tokenExpiry));

  return c.json({ data: { token, expiresIn: authConfig.tokenExpiry } });
});
```

## 安全考虑

1. **密码存储**: 初期使用明文，后续升级为 bcrypt hash
2. **JWT Secret**: 必须使用强随机字符串，不能泄露
3. **Token 过期**: 建议设置合理的过期时间（24h）
4. **HTTPS**: 生产环境必须使用 HTTPS 传输
5. **CORS**: 正确配置 CORS 白名单

## 测试计划

### 单元测试

- JWT 生成和验证
- 配置加载
- 密码验证逻辑

### 集成测试

- 登录成功流程
- 登录失败（错误密码）
- Token 验证成功
- Token 过期处理
- 无 token 访问受保护路由

### 手动测试

- Web 端登录流程
- Token 存储和自动携带
- 刷新页面保持登录状态
- Token 过期自动跳转登录页

## 参考资料

- [JWT 规范 (RFC 7519)](https://datatracker.ietf.org/doc/html/rfc7519)
- [jsonwebtoken 库文档](https://github.com/auth0/node-jsonwebtoken)
- [Hono 中间件文档](https://hono.dev/docs/guides/middleware)

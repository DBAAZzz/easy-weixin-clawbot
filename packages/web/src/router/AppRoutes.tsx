import { Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../layout/AppShell.js";
import { ProtectedRoute } from "./ProtectedRoute.js";
import { protectedRoutes, publicRoutes } from "./routes.js";

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense>
        <Routes>
          {publicRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={<r.Component />} />
          ))}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            {protectedRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={<r.Component />} />
            ))}
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

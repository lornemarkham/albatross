import { Route, Routes } from "react-router-dom";
import { CookMode } from "./CookMode";
import { IdeaDetail } from "./IdeaDetail";
import { IdeasHome } from "./IdeasHome";
import { IdeasSession } from "./IdeasSession";

// "What should we cook?" prototype, mounted at /ideas (dev builds only — see
// App.tsx). One session wraps every screen so what the person said survives
// moving between them.
export default function IdeasRoutes() {
  return (
    <IdeasSession>
      <Routes>
        <Route index element={<IdeasHome />} />
        <Route path="idea/:id" element={<IdeaDetail />} />
        <Route path="cook/:kind/:id" element={<CookMode />} />
      </Routes>
    </IdeasSession>
  );
}

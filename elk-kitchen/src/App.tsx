import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { KitchenProvider } from "./context/KitchenContext";
import { RecipeListPage } from "./pages/RecipeListPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeFormPage } from "./pages/RecipeFormPage";
import { CookEntryPage } from "./pages/CookEntryPage";
import { DataPage } from "./pages/DataPage";

// "What should we cook?" prototype (src/prototype). Only in `npm run dev`, or
// a build made with VITE_KITCHEN_PROTOTYPE=1 — never in a normal production
// build. It reads recipes and writes nothing.
const SHOW_IDEAS_PROTOTYPE = import.meta.env.DEV || import.meta.env.VITE_KITCHEN_PROTOTYPE === "1";
const IdeasPrototype = SHOW_IDEAS_PROTOTYPE ? lazy(() => import("./prototype/IdeasRoutes")) : null;

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <KitchenProvider>
          <Routes>
            <Route path="/" element={<RecipeListPage />} />
            <Route path="/add" element={<RecipeFormPage />} />
            <Route path="/recipe/:id" element={<RecipeDetailPage />} />
            <Route path="/recipe/:id/edit" element={<RecipeFormPage />} />
            <Route path="/recipe/:id/cook" element={<CookEntryPage />} />
            <Route path="/data" element={<DataPage />} />
            {IdeasPrototype && (
              <Route path="/ideas/*" element={<Suspense fallback={null}><IdeasPrototype /></Suspense>} />
            )}
          </Routes>
        </KitchenProvider>
      </div>
    </BrowserRouter>
  );
}

export default App;

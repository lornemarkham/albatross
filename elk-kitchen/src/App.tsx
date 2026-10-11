import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { KitchenProvider } from "./context/KitchenContext";
import { RecipeListPage } from "./pages/RecipeListPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeFormPage } from "./pages/RecipeFormPage";
import { CookEntryPage } from "./pages/CookEntryPage";
import { DataPage } from "./pages/DataPage";
import { PhotoCapturePage } from "./pages/PhotoCapturePage";
import { PantryPage } from "./pages/PantryPage";

// "What should we cook?" (src/prototype — the name is historical). Reads the
// family's recipes and ELK Pantry, writes nothing; its example ideas and
// keyword replies are labelled as such on the page.
const IdeasPrototype = lazy(() => import("./prototype/IdeasRoutes"));

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <KitchenProvider>
          <Routes>
            <Route path="/" element={<RecipeListPage />} />
            <Route path="/add" element={<RecipeFormPage />} />
            <Route path="/add/photo" element={<PhotoCapturePage />} />
            <Route path="/pantry" element={<PantryPage />} />
            <Route path="/recipe/:id" element={<RecipeDetailPage />} />
            <Route path="/recipe/:id/edit" element={<RecipeFormPage />} />
            <Route path="/recipe/:id/cook" element={<CookEntryPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/ideas/*" element={<Suspense fallback={null}><IdeasPrototype /></Suspense>} />
          </Routes>
        </KitchenProvider>
      </div>
    </BrowserRouter>
  );
}

export default App;

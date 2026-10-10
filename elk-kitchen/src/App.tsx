import { BrowserRouter, Routes, Route } from "react-router-dom";
import { KitchenProvider } from "./context/KitchenContext";
import { RecipeListPage } from "./pages/RecipeListPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeFormPage } from "./pages/RecipeFormPage";
import { CookEntryPage } from "./pages/CookEntryPage";
import { DataPage } from "./pages/DataPage";

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
          </Routes>
        </KitchenProvider>
      </div>
    </BrowserRouter>
  );
}

export default App;

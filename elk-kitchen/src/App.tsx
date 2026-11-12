import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { KitchenProvider } from "./context/KitchenContext";
import { RecipeListPage } from "./pages/RecipeListPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeFormPage } from "./pages/RecipeFormPage";
import { CookEntryPage } from "./pages/CookEntryPage";
import { DataPage } from "./pages/DataPage";
import { PhotoCapturePage } from "./pages/PhotoCapturePage";
import { AddFoodPage } from "./pages/AddFoodPage";
import { PantryPage } from "./pages/PantryPage";
import { StartCookingPage } from "./pages/StartCookingPage";
import { CookingSessionPage } from "./pages/CookingSessionPage";
import { CookingReviewPage } from "./pages/CookingReviewPage";
import { BatchJournalPage } from "./pages/BatchJournalPage";
import { HistoryPage } from "./pages/HistoryPage";
import { CompanionPage } from "./pages/CompanionPage";
import { PlanPage } from "./pages/PlanPage";
import { SausageDayPage } from "./pages/SausageDayPage";
import { FinishDayPage } from "./pages/FinishDayPage";
import { TastingPage } from "./pages/TastingPage";
import { KitchenHomePage } from "./pages/KitchenHomePage";
import { ShoppingPage } from "./pages/ShoppingPage";
import { HomeShell } from "./components/HomeShell";

// "What should we cook?" (src/prototype — the name is historical). Reads the
// family's recipes and ELK Pantry, writes nothing; its example ideas and
// keyword replies are labelled as such on the page.
const IdeasPrototype = lazy(() => import("./prototype/IdeasRoutes"));

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <KitchenProvider>
          <HomeShell>
          <Routes>
            <Route path="/" element={<KitchenHomePage />} />
            <Route path="/recipes" element={<RecipeListPage />} />
            <Route path="/shopping" element={<ShoppingPage />} />
            <Route path="/add" element={<RecipeFormPage />} />
            <Route path="/add/photo" element={<PhotoCapturePage />} />
            <Route path="/pantry" element={<PantryPage />} />
            <Route path="/food" element={<AddFoodPage />} />
            <Route path="/recipe/:id" element={<RecipeDetailPage />} />
            <Route path="/recipe/:id/edit" element={<RecipeFormPage />} />
            <Route path="/recipe/:id/cook" element={<CookEntryPage />} />
            <Route path="/recipe/:id/batch/:entryId" element={<BatchJournalPage />} />
            <Route path="/cook" element={<StartCookingPage />} />
            <Route path="/cook/:sessionId" element={<CookingSessionPage />} />
            <Route path="/cook/:sessionId/review" element={<CookingReviewPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/tonight" element={<CompanionPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/plan/:id" element={<PlanPage />} />
            <Route path="/sausage-day" element={<SausageDayPage />} />
            <Route path="/sausage-day/:id" element={<SausageDayPage />} />
            <Route path="/sausage-day/:id/finish" element={<FinishDayPage />} />
            <Route path="/taste/:planId/:recipeId" element={<TastingPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/ideas/*" element={<Suspense fallback={null}><IdeasPrototype /></Suspense>} />
          </Routes>
          </HomeShell>
        </KitchenProvider>
      </div>
    </BrowserRouter>
  );
}

export default App;

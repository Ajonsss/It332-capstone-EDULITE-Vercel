import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { useTheme } from "./utils/theme";
import { lazy, Suspense } from "react";
import LoadingIndicator from "./components/LoadingIndicator";

const Login = lazy(() => import("./components/Login"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const StudentForm = lazy(() => import("./components/StudentForm"));
const AssessmentForm = lazy(() => import("./components/AssessmentForm"));

function App() {
  useTheme();
  return (
    <Router>
      <Suspense fallback={<LoadingIndicator className="min-h-screen" />}>
        <Routes>
          <Route
            path="/"
            element={<Login />}
          />

          <Route
            path="/dashboard"
            element={<Dashboard />}
          />

          <Route
            path="/student-form"
            element={<StudentForm />}
          />

          <Route
            path="/student-form/:id"
            element={<StudentForm />}
          />

          <Route
            path="/assessment-form"
            element={<AssessmentForm />}
          />

          <Route
            path="/assessment-form/:id"
            element={<AssessmentForm />}
          />

          <Route
            path="*"
            element={
              <Navigate to="/" />
            }
          />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;

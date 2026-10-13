import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { useTheme } from "./utils/theme";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import StudentForm from "./components/StudentForm";
import AssessmentForm from "./components/AssessmentForm";

function App() {
  useTheme();
  return (
    <Router>
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
    </Router>
  );
}

export default App;
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Meeting from "./pages/Meeting";
import Summary from "./pages/Summary";
import Dashboard from "./pages/Dashboard";

export default function App() {
	return (
		<Layout>
			<Routes>
				<Route path="/" element={<Home />} />
				<Route path="/dashboard" element={<Dashboard />} />
				<Route path="/meeting/:roomId" element={<Meeting />} />
				<Route path="/summary/:roomId" element={<Summary />} />
			</Routes>
		</Layout>
	);
}
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Meeting from "./pages/Meeting";
import Summary from "./pages/Summary";

export default function App() {
	return (
		<Routes>
			<Route path="/" element={<Home />} />
			<Route path="/meeting/:roomId" element={<Meeting />} />
			<Route path="/summary/:roomId" element={<Summary />} />
		</Routes>
	);
}
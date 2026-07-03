import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export default function Layout({ children }: { children: ReactNode }) {
	const location = useLocation();
	const isMeeting = location.pathname.startsWith("/meeting/");

	if (isMeeting) {
		return <>{children}</>;
	}

	return (
		<div className="page-wrapper">
			<nav className="navbar">
				<Link to="/" className="navbar-brand">
					<img src="/favicon.svg" alt="VE Rooom" className="navbar-logo" />
					<span className="navbar-brand-text">VE Rooom</span>
				</Link>
				<div className="navbar-links">
					<Link to="/" className={`navbar-link ${location.pathname === "/" ? "active" : ""}`}>
						Home
					</Link>
					<Link to="/dashboard" className={`navbar-link ${location.pathname === "/dashboard" ? "active" : ""}`}>
						Dashboard
					</Link>
				</div>
			</nav>
			<div className="page-content">{children}</div>
		</div>
	);
}